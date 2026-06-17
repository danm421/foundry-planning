import { auth } from "@clerk/nextjs/server";
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
import { safeForgeErrorMessage } from "@/domain/forge/safe-error";
import { isForgeEnabled } from "@/domain/forge/flag";
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
  let entitlements: string[] | undefined;
  try {
    firmId = await requireOrgId();
    ({ id: clientId } = await ctx.params);
    await requireActiveSubscription();
    const { userId: uid, sessionClaims } = await auth();
    if (!uid) return json(401, { error: "Unauthorized" });
    userId = uid;
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
  if (!entitlements?.includes("ai_forge") && !entitlements?.includes("ai_copilot")) {
    return json(403, { error: "Forge is not enabled for your plan." });
  }

  // 5. Client scope (firm + staff). False → 404 (existence must not leak).
  if (!(await verifyClientAccess(clientId, firmId))) {
    return new Response("Not found", { status: 404 });
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
  if (message.length === 0 && !hasPendingImport) {
    return json(400, { error: "message must not be empty." });
  }
  const modelMessage =
    message.length > 0 ? message : "I've attached a document for you to review.";

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
    });
    systemPrompt = () =>
      buildSystemPrompt({
        ...promptCtx,
        currentPage: body.currentPage,
        pendingImport:
          typeof body.pendingImportId === "string" && body.pendingImportId.length > 0
            ? { importId: body.pendingImportId }
            : undefined,
      });
  } catch {
    return json(500, { error: "Internal server error." });
  }

  const graph = buildGraph(authContext, getCheckpointer(), cid, systemPrompt);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ type: "conversation", conversationId: cid });
      try {
        const events = graph.streamEvents(
          { messages: [new HumanMessage(modelMessage)], authContext },
          { version: "v2", configurable: { thread_id: cid }, recursionLimit: 25 },
        );
        for await (const ev of events) {
          if (ev.event === "on_chat_model_stream") {
            const chunk = ev.data?.chunk;
            // Phase 0 assumes string content (OpenAI text deltas). Array/multimodal content
            // blocks (Phase 1+ tool/reasoning output) would need normalizing here.
            const text = typeof chunk?.content === "string" ? chunk.content : "";
            if (text) send({ type: "token", text });
          } else if (ev.event === "on_tool_start") {
            send({ type: "tool_start", name: ev.name });
          } else if (ev.event === "on_tool_end") {
            send({ type: "tool_end", name: ev.name });
          }
        }
        await touchConversation(cid, userId);

        // A write tool (Phase 2) interrupts before executing; surface the approval
        // payload. Phase-1 read/compute graphs never interrupt → tasks is empty and
        // this branch is inert, but the wiring is here.
        const snapshot = await graph.getState({ configurable: { thread_id: cid } });
        const pending = snapshot.tasks?.find(
          (t: { interrupts?: unknown[] }) => t.interrupts?.length,
        );
        if (pending) {
          const intr = (pending.interrupts as Array<{
            value: { previews: unknown; calls: unknown };
          }>)[0].value;
          send({ type: "approval_required", previews: intr.previews, calls: intr.calls });
        }

        send({ type: "done" });
      } catch (err) {
        // §C: never emit raw err.message — it may leak client ids / internals.
        send({ type: "error", message: safeForgeErrorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
