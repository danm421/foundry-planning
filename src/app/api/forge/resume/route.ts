import { auth, currentUser } from "@clerk/nextjs/server";
import { Command } from "@langchain/langgraph";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { checkForgeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { buildGraph } from "@/domain/forge/graph";
import { getCheckpointer } from "@/domain/forge/checkpointer";
import { touchConversation, userOwnsConversation } from "@/domain/forge/conversations";
import { buildGlobalSystemPrompt } from "@/domain/forge/global-system-prompt";
import { safeForgeErrorMessage } from "@/domain/forge/safe-error";
import { maybeLangfuseHandler, flushLangfuse } from "@/domain/forge/observability";
import { parseApprovalInterrupt } from "@/domain/forge/interrupts";
import { isForgeEnabled, hasForgeEntitlement } from "@/domain/forge/flag";
import type { ForgeAuthContext, ForgeGlobalAuthContext, ForgeAnyAuthContext } from "@/domain/forge/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ResumeBody = { conversationId: string; decisions?: Record<string, "confirm" | "reject"> };
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request): Promise<Response> {
  // 1. Feature flag — 404 when off.
  if (!isForgeEnabled()) return new Response("Not found", { status: 404 });

  // 2-4. Tenant → active subscription → auth + entitlement.
  let firmId: string, userId: string, firmName: string, advisorName: string | undefined;
  let entitlements: string[] | undefined;
  const todayISO = new Date().toISOString().slice(0, 10);
  try {
    firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId: uid, sessionClaims } = await auth();
    if (!uid) return json(401, { error: "Unauthorized" });
    userId = uid;
    const u = await currentUser();
    advisorName = [u?.firstName, u?.lastName].filter(Boolean).join(" ") || undefined;
    const claims = sessionClaims as { org_public_metadata?: { entitlements?: string[] }; org_name?: string } | null;
    entitlements = claims?.org_public_metadata?.entitlements;
    firmName = claims?.org_name ?? "your firm";
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return json(mapped.status, mapped.body);
    throw err;
  }
  if (!hasForgeEntitlement(entitlements)) return json(403, { error: "Forge is not enabled for your plan." });

  // 5. Rate limit (fail-closed).
  const rl = await checkForgeRateLimit(firmId);
  if (!rl.allowed) return rateLimitErrorResponse(rl, "Too many Forge requests. Please wait a moment and try again.");

  // --- Body ---
  let body: ResumeBody;
  try { body = (await req.json()) as ResumeBody; } catch { return json(400, { error: "Invalid request body." }); }
  if (typeof body.conversationId !== "string") return json(400, { error: "conversationId is required." });
  if (typeof body.decisions !== "object" || body.decisions === null) {
    return json(400, { error: "decisions is required." });
  }
  if (!Object.values(body.decisions).every((v) => v === "confirm" || v === "reject")) {
    return json(400, { error: "decisions must map to 'confirm' or 'reject'." });
  }
  const conversationId = body.conversationId;

  // --- IDOR (two pins; buildGraph runs only after BOTH pass) ---

  // (a) User pin: a conversation the caller does not own → 404.
  if (!(await userOwnsConversation(conversationId, userId))) return new Response("Not found", { status: 404 });

  // (b) Global-thread pin: the checkpoint MUST be a GLOBAL thread (no clientId)
  // owned by this user. A client thread ("clientId" in persisted) must resume
  // via the client route — refusing it here is the global-route IDOR guard.
  try {
    const tuple = await getCheckpointer().getTuple({ configurable: { thread_id: conversationId } });
    const persisted = tuple?.checkpoint?.channel_values?.authContext as ForgeAnyAuthContext | undefined;
    if (!persisted || "clientId" in persisted || persisted.userId !== userId) {
      return new Response("Not found", { status: 404 });
    }
  } catch { return json(500, { error: "Internal server error." }); }

  const authContext: ForgeGlobalAuthContext = { userId, firmId };
  const systemPrompt = () => buildGlobalSystemPrompt({ firmName, advisorName, todayISO });

  // Conversation-level approval marker (route-level; per-write write_approved is
  // owned by the tools). Only fire when at least one decision is a confirm.
  const verdicts = Object.values(body.decisions);
  const confirmed = verdicts.filter((v) => v === "confirm").length;
  const rejected = verdicts.filter((v) => v === "reject").length;
  if (confirmed > 0) {
    await recordAudit({
      action: "forge.write_approved",
      resourceType: "forge_conversation",
      resourceId: conversationId,
      firmId,
      actorId: userId,
      metadata: { mode: "global", confirmed, rejected },
    });
  }

  const graph = buildGraph(authContext, getCheckpointer(), conversationId, systemPrompt);
  const langfuse = maybeLangfuseHandler(authContext as ForgeAuthContext, conversationId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => { if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); };
      const onAbort = () => { closed = true; try { controller.close(); } catch {} };
      req.signal.addEventListener("abort", onAbort);
      try {
        const events = graph.streamEvents(new Command({ resume: { decisions: body.decisions } }), {
          version: "v2",
          configurable: { thread_id: conversationId },
          signal: req.signal,
          recursionLimit: 25,
          ...(langfuse ? { callbacks: [langfuse] } : {}),
        });
        for await (const ev of events) {
          if (closed) break;
          if (ev.event === "on_chat_model_stream") {
            const text = typeof ev.data?.chunk?.content === "string" ? ev.data.chunk.content : "";
            if (text) send({ type: "token", text });
          } else if (ev.event === "on_tool_start") { send({ type: "tool_start", name: ev.name }); }
          else if (ev.event === "on_tool_end") { send({ type: "tool_end", name: ev.name }); }
          else if (ev.event === "on_custom_event" && ev.name !== "forge_verify") {
            send({ type: ev.name, ...(ev.data as Record<string, unknown>) });
          }
        }
        if (!closed) {
          await touchConversation(conversationId, userId);
          const snapshot = await graph.getState({ configurable: { thread_id: conversationId } });
          const pending = snapshot.tasks?.find((t: { interrupts?: unknown[] }) => t.interrupts?.length);
          if (pending) {
            const raw = (pending.interrupts as Array<{ value: unknown }>)[0].value;
            const intr = parseApprovalInterrupt(raw);
            send({ type: "approval_required", previews: intr.previews, calls: intr.calls });
          }
          send({ type: "done" });
        }
      } catch (err) {
        send({ type: "error", message: safeForgeErrorMessage(err) });
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
