import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, authErrorResponse } from "@/lib/authz";
import { isForgeEnabled, hasForgeEntitlement } from "@/domain/forge/flag";
import { listMyConversations } from "@/domain/forge/conversations";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(_req: Request): Promise<Response> {
  if (!isForgeEnabled()) return new Response("Not found", { status: 404 });
  let firmId: string, userId: string;
  let entitlements: string[] | undefined;
  try {
    firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId: uid, sessionClaims } = await auth();
    if (!uid) return json(401, { error: "Unauthorized" });
    userId = uid;
    entitlements = (sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null)
      ?.org_public_metadata?.entitlements;
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return json(mapped.status, mapped.body);
    throw err;
  }
  if (!hasForgeEntitlement(entitlements)) return json(403, { error: "Forge is not enabled for your plan." });

  // GLOBAL history = the caller's threads with no client. Pass null so the SQL
  // WHERE clause includes IS NULL before the .limit(50) — prevents client-scoped
  // threads from consuming limit slots and crowding out global threads.
  const conversations = await listMyConversations(userId, firmId, null);
  return json(200, { conversations });
}
