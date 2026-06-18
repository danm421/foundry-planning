import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkForgeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { buildGraph } from "@/domain/forge/graph";
import { getCheckpointer } from "@/domain/forge/checkpointer";
import { userOwnsConversation } from "@/domain/forge/conversations";
import { undoToCheckpoint } from "@/domain/forge/time-travel";
import { isForgeEnabled, hasForgeEntitlement } from "@/domain/forge/flag";
import type { ForgeAuthContext } from "@/domain/forge/state";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };
type UndoBody = { conversationId: string; checkpointId: string };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  // --- Gate chain (mirrors the resume route, IN ORDER) ---

  // 1. Feature flag (strict "true"). 404 when off.
  if (!isForgeEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  // 2-4. Tenant → active subscription → auth + entitlement.
  let firmId: string;
  let clientId: string;
  let userId: string;
  let entitlements: string[] | undefined;
  try {
    firmId = await requireOrgId();
    ({ id: clientId } = await ctx.params);
    await requireActiveSubscription();
    const { userId: uid, sessionClaims } = await auth();
    if (!uid) return json(401, { error: "Unauthorized" });
    userId = uid;
    const claims = sessionClaims as
      | { org_public_metadata?: { entitlements?: string[] } }
      | null;
    entitlements = claims?.org_public_metadata?.entitlements;
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return json(mapped.status, mapped.body);
    throw err;
  }
  if (!hasForgeEntitlement(entitlements)) {
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
  let body: UndoBody;
  try {
    body = (await req.json()) as UndoBody;
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  if (
    typeof body.conversationId !== "string" ||
    body.conversationId.length === 0 ||
    typeof body.checkpointId !== "string" ||
    body.checkpointId.length === 0
  ) {
    return json(400, { error: "conversationId and checkpointId are required." });
  }
  const conversationId = body.conversationId;
  const checkpointId = body.checkpointId;

  // --- IDOR (two pins; the rewind runs only after BOTH pass) ---

  // (a) User pin: a conversation the caller does not own returns 404.
  if (!(await userOwnsConversation(conversationId, userId))) {
    return new Response("Not found", { status: 404 });
  }

  // (b) Client pin: the checkpointed authContext.clientId MUST equal the URL
  // clientId, AND the checkpointed authContext.userId MUST equal the requesting
  // userId. A missing checkpoint (nothing to undo) or a mismatch (the conversation
  // belongs to a different client/user) both 404, never leaking.
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

  // Rebuild the scope FROM THE CHECKPOINT (canonical contract): userId/firmId/
  // clientId re-derived server-side this request; scenarioId recovered from the
  // checkpoint so the reverted state keeps the ORIGINAL scenario.
  const authContext: ForgeAuthContext = {
    userId,
    firmId,
    clientId,
    scenarioId: checkpointAuth.scenarioId,
  };

  // No model turn runs on an undo — only updateState — so the system prompt is
  // unused. Pass an empty thunk to avoid loadPromptContext's DB read.
  const graph = buildGraph(authContext, getCheckpointer(), conversationId, () => "");
  try {
    await undoToCheckpoint(conversationId, checkpointId, authContext, graph);
  } catch {
    return json(500, { error: "Internal server error." });
  }

  await recordAudit({
    action: "forge.undo",
    resourceType: "forge_conversation",
    resourceId: conversationId,
    clientId,
    firmId,
    actorId: userId,
    metadata: { checkpointId },
  });

  return json(200, { ok: true });
}
