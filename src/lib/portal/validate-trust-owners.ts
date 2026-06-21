import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import type { ValidatedOwner } from "@/lib/ownership";

/**
 * Portal-only rule: entity owners on a portal-managed account may ONLY be trusts.
 *
 * The portal owner-picker renders trust entities exclusively, so a non-trust
 * entity owner (LLC, S-corp, …) can only arrive via a hand-crafted request. It's
 * still the bound client's *own* entity — tenant-safe, no cross-client leak — but
 * it's outside the portal's contract, so we reject it server-side.
 *
 * Deliberately NOT folded into the shared `validateOwnersTenant`: that helper
 * also serves the liability routes and the advisor app, where non-trust entity
 * owners are legitimate. This guard is portal-account-route-only.
 *
 * Assumes tenancy was already validated by `validateOwnersTenant`; the clientId
 * filter here is defense-in-depth. Returns { error } on the first non-trust
 * entity owner (or a missing row), null when every entity owner is a trust.
 */
export async function validateTrustOnlyEntityOwners(
  owners: ValidatedOwner[],
  clientId: string,
): Promise<{ error: string } | null> {
  for (const o of owners) {
    if (o.kind !== "entity") continue;
    const [row] = await db
      .select({ entityType: entities.entityType })
      .from(entities)
      .where(and(eq(entities.id, o.entityId), eq(entities.clientId, clientId)))
      .limit(1);
    if (!row || row.entityType !== "trust") {
      return { error: "Account entity owners must be trusts" };
    }
  }
  return null;
}
