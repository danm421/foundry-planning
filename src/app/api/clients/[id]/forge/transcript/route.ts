import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { clientToHousehold } from "@/domain/forge/guards";
import { isForgeEnabled, hasForgeEntitlement } from "@/domain/forge/flag";
import { checkForgeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { createMeetingTranscript } from "@/lib/forge/meeting-transcripts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteCtx = { params: Promise<{ id: string }> };
type Body = { text: string; conversationId?: string; source?: "paste" | "explicit" };

const MAX_TRANSCRIPT_CHARS = 500_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  // 1. Feature flag (canonical single source of truth — strict "true"). 404 when off.
  if (!isForgeEnabled()) return new Response("Not found", { status: 404 });

  // 2-4. Tenant → active subscription → auth + entitlement. Throwing auth/sub
  // checks are converted to a response via authErrorResponse.
  let firmId: string;
  let clientId: string;
  let entitlements: string[] | undefined;
  try {
    firmId = await requireOrgId();
    ({ id: clientId } = await ctx.params);
    // MANDATORY: same active-subscription gate the stream route runs.
    await requireActiveSubscription();
    const { userId, sessionClaims } = await auth();
    if (!userId) return json(401, { error: "Unauthorized" });
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

  // 5. Client scope (firm + staff). Not-ok → 404; view-only → 403.
  const access = await verifyClientAccess(clientId);
  if (!access.ok) return new Response("Not found", { status: 404 });
  if (access.permission !== "edit") return json(403, { error: "View-only access" });

  // 6. Rate limit (fail-closed).
  const rl = await checkForgeRateLimit(firmId);
  if (!rl.allowed)
    return rateLimitErrorResponse(rl, "Too many Forge requests. Try again shortly.");

  // --- Body ---
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { error: "Invalid request body." });
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (text.trim().length < 200) {
    return json(400, { error: "Transcript is too short." });
  }
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    return json(413, { error: "Transcript is too large." });
  }

  // Resolve the household scoped to the verified firm (IDOR-safe).
  let householdId: string;
  try {
    householdId = await clientToHousehold(clientId, firmId);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const { id, wordCount } = await createMeetingTranscript({
    clientId,
    householdId,
    firmId,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
    rawText: text,
    source: body.source === "explicit" ? "explicit" : "paste",
  });

  return json(200, { transcriptId: id, wordCount });
}
