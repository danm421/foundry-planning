import { auth } from "@clerk/nextjs/server";
import { Command } from "@langchain/langgraph";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkForgeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { buildGraph } from "@/domain/forge/graph";
import { getCheckpointer } from "@/domain/forge/checkpointer";
import { touchConversation, userOwnsConversation } from "@/domain/forge/conversations";
import { loadPromptContext } from "@/domain/forge/load-prompt-context";
import { buildSystemPrompt } from "@/domain/forge/system-prompt";
import { safeForgeErrorMessage } from "@/domain/forge/safe-error";
import { isForgeEnabled } from "@/domain/forge/flag";
import type { ForgeAuthContext } from "@/domain/forge/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ id: string }> };
type ResumeBody = {
  conversationId: string;
  decisions: Record<string, "confirm" | "reject">;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  // --- Gate chain (mirrors the stream route, IN ORDER — ALL before the stream) ---

  // 1. Feature flag (canonical single source of truth — strict "true"). 404 when off.
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
    // MANDATORY: same active-subscription gate the stream route runs. Omitting it
    // would add this route to the active-subscription-lint failing baseline.
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
  if (!entitlements?.includes("ai_copilot")) {
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

  // --- Body ---
  let body: ResumeBody;
  try {
    body = (await req.json()) as ResumeBody;
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  if (
    typeof body.conversationId !== "string" ||
    typeof body.decisions !== "object" ||
    body.decisions === null
  ) {
    return json(400, { error: "conversationId and decisions are required." });
  }
  // Every decision verdict must be a recognized confirm|reject — reject anything
  // else before it reaches the graph's resume Command.
  if (!Object.values(body.decisions).every((v) => v === "confirm" || v === "reject")) {
    return json(400, { error: "decisions must map to 'confirm' or 'reject'." });
  }
  const conversationId = body.conversationId;
  const decisions = body.decisions;

  // --- IDOR (two pins; buildGraph runs only after BOTH pass) ---

  // (a) User pin: a conversation the caller does not own returns 404.
  if (!(await userOwnsConversation(conversationId, userId))) {
    return new Response("Not found", { status: 404 });
  }

  // (b) Client pin: the checkpointed authContext.clientId MUST equal the URL
  // clientId, AND the checkpointed authContext.userId MUST equal the resuming
  // userId. Pinning the user to the same object that drives execution scope binds
  // the user check to the checkpoint that actually runs (hardening against a
  // future conversation-handoff feature). This is the canonical "pin the
  // conversation IDOR to the URL clientId" guard — a missing checkpoint (nothing
  // to resume) or a mismatch (pending write belongs to a different client/user)
  // both 404, never leaking.
  let checkpointAuth: ForgeAuthContext;
  try {
    const tuple = await getCheckpointer().getTuple({
      configurable: { thread_id: conversationId },
    });
    const persisted = tuple?.checkpoint?.channel_values?.authContext as
      | ForgeAuthContext
      | undefined;
    if (!persisted || persisted.clientId !== clientId || persisted.userId !== userId) {
      return new Response("Not found", { status: 404 });
    }
    checkpointAuth = persisted;
  } catch {
    return json(500, { error: "Internal server error." });
  }

  // --- Rebuild the resumed scope FROM THE CHECKPOINT (canonical contract) ---
  // userId/firmId/clientId are re-derived server-side this request; scenarioId is
  // recovered from the checkpoint so the resumed summary turn's prompt and any
  // ctx.scenarioId-dependent read/compute tool run against the ORIGINAL scenario,
  // never a default. (compute.ts reads ctx.scenarioId directly.)
  const authContext: ForgeAuthContext = {
    userId,
    firmId,
    clientId,
    scenarioId: checkpointAuth.scenarioId,
  };

  let systemPrompt: () => string;
  try {
    const promptCtx = await loadPromptContext({
      clientId,
      firmId,
      scenarioId: authContext.scenarioId,
      firmName,
    });
    systemPrompt = () => buildSystemPrompt(promptCtx);
  } catch {
    return json(500, { error: "Internal server error." });
  }

  // Conversation-level resume marker. The PER-WRITE write_approved is owned by
  // the tools (only on real success); this records the advisor's approval of the
  // resume turn with a confirmed/rejected breakdown. Only fire when at least one
  // decision is a confirm — an all-reject (or empty) resume approves nothing, and
  // the per-write write_approved (tools) + write_rejected (node) already cover
  // that case, so recording a route-level approval here would be a false positive.
  const verdicts = Object.values(decisions);
  const confirmed = verdicts.filter((v) => v === "confirm").length;
  const rejected = verdicts.filter((v) => v === "reject").length;
  if (confirmed > 0) {
    await recordAudit({
      action: "copilot.write_approved",
      resourceType: "copilot_conversation",
      resourceId: conversationId,
      clientId,
      firmId,
      actorId: userId,
      metadata: { confirmed, rejected },
    });
  }

  const graph = buildGraph(authContext, getCheckpointer(), conversationId, systemPrompt);
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
      // itself is cancelled, not just the SSE write side.
      // DIVERGENCE (intentional): this resume route handles req.signal
      // cancel-on-disconnect; the stream route does NOT yet (logged open item in
      // security-hardening.md "## Open — Forge Phase-0", "Abort the in-flight
      // Azure request on client disconnect"). A future PR should backport this here.
      const onAbort = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", onAbort);
      try {
        const events = graph.streamEvents(new Command({ resume: { decisions } }), {
          version: "v2",
          configurable: { thread_id: conversationId },
          signal: req.signal,
          recursionLimit: 25,
        });
        for await (const ev of events) {
          if (closed) break;
          if (ev.event === "on_chat_model_stream") {
            const chunk = ev.data?.chunk;
            const text = typeof chunk?.content === "string" ? chunk.content : "";
            if (text) send({ type: "token", text });
          } else if (ev.event === "on_tool_start") {
            send({ type: "tool_start", name: ev.name });
          } else if (ev.event === "on_tool_end") {
            send({ type: "tool_end", name: ev.name });
          }
        }
        if (!closed) {
          await touchConversation(conversationId, userId);

          // A chained write (the resumed turn proposed another write) interrupts
          // again; surface its approval payload before done so the UI can prompt.
          const snapshot = await graph.getState({
            configurable: { thread_id: conversationId },
          });
          const pending = snapshot.tasks?.find(
            (t: { interrupts?: unknown[] }) => t.interrupts?.length,
          );
          if (pending) {
            const intr = (pending.interrupts as Array<{
              value: { previews: unknown; calls: unknown };
            }>)[0].value;
            send({
              type: "approval_required",
              previews: intr.previews,
              calls: intr.calls,
            });
          }

          send({ type: "done" });
        }
      } catch (err) {
        // Never emit raw err.message — it may leak client ids / internals.
        send({ type: "error", message: safeForgeErrorMessage(err) });
      } finally {
        req.signal.removeEventListener("abort", onAbort);
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
