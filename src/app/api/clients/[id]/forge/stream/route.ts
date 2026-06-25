import { auth, currentUser } from "@clerk/nextjs/server";
import { HumanMessage } from "@langchain/core/messages";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkForgeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { buildGraph } from "@/domain/forge/graph";
import { getCheckpointer } from "@/domain/forge/checkpointer";
import {
  createConversation,
  touchConversation,
  userOwnsConversation,
} from "@/domain/forge/conversations";
import { loadPromptContext } from "@/domain/forge/load-prompt-context";
import { buildSystemPrompt } from "@/domain/forge/system-prompt";
import { categorizeForgeError, logForgeError } from "@/domain/forge/safe-error";
import { maybeLangfuseHandler, flushLangfuse } from "@/domain/forge/observability";
import { parseApprovalInterrupt, parseMeetingReviewInterrupt } from "@/domain/forge/interrupts";
import { isForgeEnabled, hasForgeEntitlement } from "@/domain/forge/flag";
import type { ForgeAuthContext } from "@/domain/forge/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ id: string }> };
type StreamBody = {
  message: string;
  conversationId?: string;
  scenarioId: string;
  currentPage?: string;
  pendingImportId?: string;
  pendingTranscriptId?: string;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  // --- Gate chain (canonical order — ALL before the ReadableStream opens) ---

  // 1. Feature flag (canonical single source of truth — strict "true").
  if (!isForgeEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  // 2-4. Tenant → active subscription → auth + entitlement. Throwing auth/sub
  // checks are converted to a response via authErrorResponse.
  let firmId: string;
  let clientId: string;
  let userId: string;
  let firmName: string;
  let advisorName: string | undefined;
  let entitlements: string[] | undefined;
  const todayISO = new Date().toISOString().slice(0, 10);
  try {
    firmId = await requireOrgId();
    ({ id: clientId } = await ctx.params);
    await requireActiveSubscription();
    const { userId: uid, sessionClaims } = await auth();
    if (!uid) return json(401, { error: "Unauthorized" });
    userId = uid;
    const u = await currentUser();
    advisorName = [u?.firstName, u?.lastName].filter(Boolean).join(" ") || undefined;
    const claims = sessionClaims as
      | { org_public_metadata?: { entitlements?: string[] }; org_name?: string }
      | null;
    entitlements = claims?.org_public_metadata?.entitlements;
    firmName = claims?.org_name ?? "your firm";
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return json(mapped.status, mapped.body);
    throw err;
  }
  if (!hasForgeEntitlement(entitlements)) {
    return json(403, { error: "Forge is not enabled for your plan." });
  }

  // 5. Client scope (firm + staff). Not-ok → 404 (existence must not leak);
  // view-only → 403 (copilot can propose writes).
  const access = await verifyClientAccess(clientId);
  if (!access.ok) {
    return new Response("Not found", { status: 404 });
  }
  if (access.permission !== "edit") {
    return json(403, { error: "View-only access" });
  }

  // 6. Rate limit (fail-closed; exceeded→429 else→503).
  const rl = await checkForgeRateLimit(firmId);
  if (!rl.allowed) {
    return rateLimitErrorResponse(
      rl,
      "Too many Forge requests. Please wait a moment and try again.",
    );
  }

  // --- Past the gates: body, conversation (IDOR-checked), audit, stream ---

  let body: StreamBody;
  try {
    body = (await req.json()) as StreamBody;
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  if (typeof body.message !== "string" || typeof body.scenarioId !== "string") {
    return json(400, { error: "message and scenarioId are required." });
  }
  // Trim once and validate the trimmed value: a whitespace-only message must not
  // create a blank-titled conversation or burn a model turn on empty input —
  // UNLESS a freshly-uploaded import is attached, in which case the document IS
  // the turn and the model message is synthesized below.
  const message = body.message.trim();
  const hasPendingImport =
    typeof body.pendingImportId === "string" && body.pendingImportId.length > 0;
  const hasPendingTranscript =
    typeof body.pendingTranscriptId === "string" && body.pendingTranscriptId.length > 0;
  if (message.length === 0 && !hasPendingImport && !hasPendingTranscript) {
    return json(400, { error: "message must not be empty." });
  }
  const modelMessage =
    message.length > 0
      ? message
      : hasPendingTranscript
        ? "I've pasted a meeting transcript — please summarize it and draft tasks."
        : "I've attached a document for you to review.";

  let cid: string;
  let authContext: ForgeAuthContext;
  let systemPrompt: () => string;
  try {
    let conversationId = body.conversationId;
    if (conversationId) {
      // IDOR guard: a conversation the caller does not own returns 404.
      if (!(await userOwnsConversation(conversationId, userId))) {
        return new Response("Not found", { status: 404 });
      }
    } else {
      conversationId = await createConversation({
        userId,
        firmId,
        clientId,
        title: message.length > 0 ? message.slice(0, 60) : "Document import",
      });
    }
    cid = conversationId;

    authContext = {
      userId,
      firmId,
      clientId,
      scenarioId: body.scenarioId,
    };

    await recordAudit({
      action: "forge.query",
      resourceType: "forge_conversation",
      resourceId: cid,
      clientId,
      firmId,
      actorId: userId,
      metadata: { scenarioId: body.scenarioId, currentPage: body.currentPage ?? null },
    });

    const promptCtx = await loadPromptContext({
      clientId,
      firmId,
      scenarioId: body.scenarioId,
      firmName,
      userId,
      advisorName,
      todayISO,
    });
    systemPrompt = () =>
      buildSystemPrompt({
        ...promptCtx,
        currentPage: body.currentPage,
        pendingImport:
          typeof body.pendingImportId === "string" && body.pendingImportId.length > 0
            ? { importId: body.pendingImportId }
            : undefined,
        pendingTranscript:
          typeof body.pendingTranscriptId === "string" && body.pendingTranscriptId.length > 0
            ? { transcriptId: body.pendingTranscriptId }
            : undefined,
      });
  } catch {
    return json(500, { error: "Internal server error." });
  }

  const graph = buildGraph(authContext, getCheckpointer(), cid, systemPrompt);
  const langfuse = maybeLangfuseHandler(authContext, cid);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      // Cancel-on-disconnect: stop consuming and close once the client aborts.
      // The abort signal is also threaded into streamEvents so the graph run
      // itself is cancelled, not just the SSE write side — clicking Stop stops
      // the server burning Azure/rate-limit budget, not just the client.
      const onAbort = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", onAbort);

      // Hold the agent's answer tokens in a buffer; the verify node decides when
      // they're allowed out. Hoisted above the try so the catch can flush a
      // fully-generated-but-still-buffered answer if the run dies mid-turn.
      let buffer = "";

      send({ type: "conversation", conversationId: cid });
      try {
        const events = graph.streamEvents(
          { messages: [new HumanMessage(modelMessage)], authContext, verifyAttempts: 0 },
          {
            version: "v2",
            configurable: { thread_id: cid },
            signal: req.signal,
            recursionLimit: 25,
            ...(langfuse ? { callbacks: [langfuse] } : {}),
          },
        );

        // flush() replays the buffer as small chunks so the answer still "types"
        // after the verify check.
        const REPLAY_CHUNK = 240;
        const flush = () => {
          for (let i = 0; i < buffer.length; i += REPLAY_CHUNK) {
            send({ type: "token", text: buffer.slice(i, i + REPLAY_CHUNK) });
          }
          buffer = "";
        };

        for await (const ev of events) {
          if (closed) break;
          if (ev.event === "on_chat_model_stream") {
            // Only the agent node produces user-facing answer tokens. The verify
            // node's critic also calls a chat model, so its tokens surface here
            // too — never buffer them, or the verdict would be flushed verbatim
            // into the reply. (Safe today only because the critic resolves to
            // functionCalling and emits empty content; this guard makes it
            // robust if that ever changes.)
            if (ev.metadata?.langgraph_node === "verify") continue;
            const chunk = ev.data?.chunk;
            // Phase 0 assumes string content (OpenAI text deltas). Array/multimodal content
            // blocks (Phase 1+ tool/reasoning output) would need normalizing here.
            const text = typeof chunk?.content === "string" ? chunk.content : "";
            if (text) buffer += text; // held, not forwarded
          } else if (ev.event === "on_tool_start") {
            flush(); // release any interstitial prose before the tool runs
            send({ type: "tool_start", name: ev.name });
          } else if (ev.event === "on_tool_end") {
            send({ type: "tool_end", name: ev.name });
          } else if (ev.event === "on_custom_event") {
            if (ev.name === "forge_verify") {
              // Verify-gate control frames govern the buffered answer.
              const data = (ev.data ?? {}) as { result?: string; caveat?: string };
              if (data.result === "start") {
                send({ type: "verifying" });
              } else if (data.result === "pass") {
                flush();
              } else if (data.result === "retry") {
                buffer = ""; // discard the rejected draft; the revision re-streams
              } else if (data.result === "caveat") {
                buffer = data.caveat ? `${data.caveat}\n\n${buffer}` : buffer;
                flush();
              }
            } else {
              // Structured custom-streaming frame (tool_render/navigate/activity) —
              // forward verbatim. Plumbing only: no tool emits these yet. Payloads
              // are already masked/grounded by the emitter (custom-events contract).
              send({ type: ev.name, ...(ev.data as Record<string, unknown>) });
            }
          }
        }
        flush(); // any final no-number answer that never hit verify

        if (!closed) {
          await touchConversation(cid, userId);

          // A write tool (Phase 2) interrupts before executing; surface the
          // approval payload. Phase-1 read/compute graphs never interrupt → tasks
          // is empty and this branch is inert, but the wiring is here.
          const snapshot = await graph.getState({ configurable: { thread_id: cid } });
          const pending = snapshot.tasks?.find(
            (t: { interrupts?: unknown[] }) => t.interrupts?.length,
          );
          if (pending) {
            const raw = (pending.interrupts as Array<{ value: unknown }>)[0].value;
            const kind = (raw as { type?: string })?.type;
            if (kind === "meeting_review") {
              const mr = parseMeetingReviewInterrupt(raw);
              send({
                type: "meeting_review",
                summaryTitle: mr.summaryTitle,
                summary: mr.summary,
                meetingDate: mr.meetingDate,
                proposedTasks: mr.proposedTasks,
              });
            } else {
              const intr = parseApprovalInterrupt(raw);
              send({ type: "approval_required", previews: intr.previews, calls: intr.calls });
            }
          }

          send({ type: "done" });
        }
      } catch (err) {
        const { safeMessage, category } = categorizeForgeError(err);
        logForgeError(category, cid);
        // Don't throw away a fully-generated answer: if we were holding verified-
        // pending tokens when the stream died, release them with an honesty caveat
        // before the error frame, so the advisor sees the work + knows it's unchecked.
        if (buffer.length > 0) {
          send({
            type: "token",
            text:
              "The figures below could not be automatically verified before the connection dropped — double-check them.\n\n" +
              buffer,
          });
          buffer = "";
        }
        send({ type: "error", message: safeMessage });
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        await flushLangfuse(langfuse);
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
