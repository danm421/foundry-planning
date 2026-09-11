import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { deriveHouseholdNameFromContacts } from "@/lib/crm/household-name";

/** Roles that name a household. Dependents and external ('other') contacts
 *  never do — see `roleAffectsHouseholdName`. */
const NAMING_ROLES = ["primary", "spouse"] as const;

/**
 * What a household is called when it derives no name of its own.
 *
 * Lives here rather than in each client-facing caller for the same reason
 * `UNNAMED_FIRM` lives beside `resolvePortalFirmNames`: a household with no
 * `primary` contact is simply ABSENT from the map below, so every caller has
 * to supply this fallback, and two copies of it drift. Deliberately addressed
 * to the reader ("Your household") — these are the client's own screens, and a
 * missing contact row is our gap, not something to spell out to them.
 */
export const UNNAMED_HOUSEHOLD = "Your household";

/**
 * Display names for a SET of households, keyed by CLIENT id, in one query.
 *
 * Batch by design: the access-request screen names every firm asking at once,
 * and asking per row would be N round trips for a list that is usually short
 * but never guaranteed to be.
 *
 * Derived live from the household's contacts rather than read off
 * `crm_households.name`, for two reasons. That column is a denormalized cache
 * kept in step by `syncHouseholdNameFromContacts`, so a missed sync would show
 * a client a stale name; and an advisor who ticked "Use a custom name" can put
 * anything in it, which is an internal label, not something to show the person
 * being asked to grant access. `deriveHouseholdNameFromContacts` is the same
 * pure function the CRM derives that column with, so a non-custom household
 * reads identically on both surfaces.
 *
 * `clients.crm_household_id` is NOT NULL and UNIQUE, so the join is 1:1 and no
 * null-household branch is reachable. A household with no `primary` contact
 * derives to null and is simply ABSENT from the map — callers render their own
 * fallback rather than being handed an empty string that looks like a name.
 */
export async function resolveHouseholdNames(
  clientIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(clientIds)];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      clientId: clients.id,
      role: crmHouseholdContacts.role,
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
    })
    .from(clients)
    .innerJoin(
      crmHouseholdContacts,
      eq(crmHouseholdContacts.householdId, clients.crmHouseholdId),
    )
    .where(
      and(
        inArray(clients.id, ids),
        inArray(crmHouseholdContacts.role, [...NAMING_ROLES]),
      ),
    );

  const byClient = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byClient.get(row.clientId);
    if (existing) existing.push(row);
    else byClient.set(row.clientId, [row]);
  }

  const names = new Map<string, string>();
  for (const [clientId, contacts] of byClient) {
    const name = deriveHouseholdNameFromContacts(contacts);
    if (name) names.set(clientId, name);
  }
  return names;
}
