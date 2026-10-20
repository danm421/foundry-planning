import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts, crmHouseholds } from "@/db/schema";
import type { Principal } from "@/lib/clients/authz";
import { verifyCrmHouseholdAccessFor } from "./authz";

export type LikelyDuplicateHousehold = { householdId: string; name: string; clientId: string | null };

/**
 * A live household in the caller's firm whose primary contact has this first
 * and last name (trimmed, any case) and date of birth — the household a new
 * one would most likely repeat; the oldest, when several match. Only one the
 * caller may see counts, under the rule every other household read follows
 * (book silo, Private clients), so the answer never discloses a colleague's
 * book. `clientId` is the household's planning client, null when it has no
 * plan yet.
 */
export async function findLikelyDuplicateHousehold(
  p: Principal,
  person: { firstName: string; lastName: string; dateOfBirth: string },
): Promise<LikelyDuplicateHousehold | null> {
  if (!p.orgId) return null;
  const candidates = await db
    .select({ householdId: crmHouseholds.id, name: crmHouseholds.name, clientId: clients.id })
    .from(crmHouseholdContacts)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, crmHouseholdContacts.householdId))
    .leftJoin(clients, eq(clients.crmHouseholdId, crmHouseholds.id))
    .where(
      and(
        eq(crmHouseholds.firmId, p.orgId),
        isNull(crmHouseholds.deletedAt),
        eq(crmHouseholdContacts.role, "primary"),
        sql`lower(trim(${crmHouseholdContacts.firstName})) = ${person.firstName.trim().toLowerCase()}`,
        sql`lower(trim(${crmHouseholdContacts.lastName})) = ${person.lastName.trim().toLowerCase()}`,
        eq(crmHouseholdContacts.dateOfBirth, person.dateOfBirth),
      ),
    )
    .orderBy(crmHouseholds.createdAt, crmHouseholds.id);
  for (const candidate of candidates) {
    if ((await verifyCrmHouseholdAccessFor(p, candidate.householdId)).ok) return candidate;
  }
  return null;
}
