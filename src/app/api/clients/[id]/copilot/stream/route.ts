import { auth } from "@clerk/nextjs/server";
import { HumanMessage } from "@langchain/core/messages";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkCopilotRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { buildGraph } from "@/domain/copilot/graph";
import { getCheckpointer } from "@/domain/copilot/checkpointer";
import {
  createConversation,
  touchConversation,
  userOwnsConversation,
} from "@/domain/copilot/conversations";
import { loadPromptContext } from "@/domain/copilot/load-prompt-context";
import { buildSystemPrompt } from "@/domain/copilot/system-prompt";
import { safeCopilotErrorMessage } from "@/domain/copilot/safe-error";
import { isCopilotEnabled } from "@/domain/copilot/flag";
import type { CopilotAuthContext } from "@/domain/copilot/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ id: string }> };
type StreamBody = {
  message: string;
  conversationId?: string;
  scenarioId: string;
  currentPage?: string;
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
  if (!isCopilotEnabled()) {
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
  if (!entitlements?.includes("ai_copilot")) {
    return json(403, { error: "AI Copilot is not enabled for your plan." });
  }

  // 5. Client scope (firm + staff). False → 404 (existence must not leak).
  if (!(await verifyClientAccess(clientId, firmId))) {
    return new Response("Not found", { status: 404 });
  }

  // 6. Rate limit (fail-closed; exceeded→429 else→503).
  const rl = await checkCopilotRateLimit(firmId);
  if (!rl.allowed) {
    return rateLimitErrorResponse(
      rl,
      "Too many copilot requests. Please wait a moment and try again.",
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
  // create a blank-titled conversation or burn a model turn on empty input.
  const message = body.message.trim();
  if (message.length === 0) {
    return json(400, { error: "message must not be empty." });
  }

  let cid: string;
  let authContext: CopilotAuthContext;
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
        title: message.slice(0, 60),
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
      action: "copilot.query",
      resourceType: "copilot_conversation",
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
      buildSystemPrompt({ ...promptCtx, currentPage: body.currentPage });
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
          { messages: [new HumanMessage(message)], authContext },
          { version: "v2", configurable: { thread_id: cid }, recursionLimit: 25 },
        );
        for await (const ev of events) {
          if (ev.event === "on_chat_model_stream") {
            const chunk = ev.data?.chunk;
            // Phase 0 assumes string content (OpenAI text deltas). Array/multimodal content
            // blocks (Phase 1+ tool/reasoning output) would need normalizing here.
            const text = typeof chunk?.content === "string" ? chunk.content : "";
            if (text) send({ type: "token", text });
          }
        }
        await touchConversation(cid, userId);
        send({ type: "done" });
      } catch (err) {
        // §C: never emit raw err.message — it may leak client ids / internals.
        send({ type: "error", message: safeCopilotErrorMessage(err) });
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
