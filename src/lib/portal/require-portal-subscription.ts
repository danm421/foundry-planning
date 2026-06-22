import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { ForbiddenError, requireActiveSubscriptionForFirm } from "@/lib/authz";

/**
 * Portal-mutation subscription gate. Portal users have no `orgId`, so the
 * advisor firm's subscription status (Clerk org publicMetadata) is checked by
 * firmId rather than the caller's own org. Resolves the client's firm then
 * defers to `requireActiveSubscriptionForFirm`.
 *
 * Throws ForbiddenError on an inactive firm (canceled/unpaid/incomplete;
 * past_due/trialing/founder stay active) or a client with no firm (fail-closed).
 * Call it in portal MUTATION handlers between requireClientPortalAccess and
 * requireEditEnabled.
 */
export async function requirePortalActiveSubscription(clientId: string): Promise<void> {
  const [row] = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row?.firmId) throw new ForbiddenError("No firm for this client");
  await requireActiveSubscriptionForFirm(row.firmId);
}
