import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { advisorScopeCondition, resolveVisibleAdvisorIds } from "@/lib/visibility";
import { containsPattern } from "@/lib/like-pattern";
import { uuidRegex } from "@/lib/schemas/common";

export interface ClientSearchResult {
  id: string;
  householdTitle: string;
  /**
   * Primary contact detail, so a caller that has to address the household —
   * the intake sender prefilling a recipient — doesn't need a second round
   * trip. `primaryEmail` is frequently null: CRM contacts carry an email only
   * when one was imported or typed, so callers must treat it as a hint and
   * keep the field editable.
   */
  primaryFirstName: string;
  primaryLastName: string;
  primaryEmail: string | null;
}

const MAX_RESULTS = 8;

/** Primary/spouse contact columns joined onto a client row. Shared by the
 *  typeahead search and the by-id lookup, so the two can't assemble a
 *  household title differently. */
const contactColumns = {
  id: clients.id,
  contactRole: crmHouseholdContacts.role,
  contactFirstName: crmHouseholdContacts.firstName,
  contactLastName: crmHouseholdContacts.lastName,
  contactEmail: crmHouseholdContacts.email,
};

type ContactRow = {
  id: string;
  contactRole: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string | null;
};

/** Collapse the joined primary/spouse rows into one result per client. */
function toSearchResults(rows: ContactRow[]): ClientSearchResult[] {
  interface Contact {
    firstName: string;
    lastName: string;
    email: string | null;
  }
  const byClient = new Map<
    string,
    { id: string; primary: Contact | null; spouse: Contact | null }
  >();
  for (const row of rows) {
    const entry = byClient.get(row.id) ?? {
      id: row.id,
      primary: null,
      spouse: null,
    };
    const contact: Contact = {
      firstName: row.contactFirstName,
      lastName: row.contactLastName,
      email: row.contactEmail,
    };
    if (row.contactRole === "primary") {
      entry.primary = contact;
    } else if (row.contactRole === "spouse") {
      entry.spouse = contact;
    }
    byClient.set(row.id, entry);
  }

  const results: ClientSearchResult[] = [];
  for (const entry of byClient.values()) {
    if (!entry.primary) continue; // households without a primary aren't reachable
    const { firstName, lastName } = entry.primary;
    const spouseFirst = entry.spouse?.firstName ?? null;
    const spouseLast = entry.spouse?.lastName ?? lastName;
    const householdTitle = spouseFirst
      ? `${firstName} & ${spouseFirst} ${spouseLast}`.trim()
      : `${firstName} ${lastName}`.trim();
    results.push({
      id: entry.id,
      householdTitle,
      primaryFirstName: firstName,
      primaryLastName: lastName,
      primaryEmail: entry.primary.email ?? null,
    });
  }
  results.sort((a, b) => a.householdTitle.localeCompare(b.householdTitle));
  return results;
}

export async function searchClients(
  query: string,
  firmId: string,
  caller: { userId: string; orgRole: string | null | undefined },
): Promise<ClientSearchResult[]> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];

  const pattern = containsPattern(trimmed);

  const visible = await resolveVisibleAdvisorIds(caller.userId, caller.orgRole, firmId);
  const scope = advisorScopeCondition(clients.advisorId, visible);

  // CRM contacts are the sole source of truth for identity. Two-step query:
  // 1) Find households whose contacts match the query (any role). 2) Pull
  // primary + spouse for those households and assemble titles.
  const matchedHouseholdIds = await db
    .selectDistinct({ householdId: crmHouseholdContacts.householdId })
    .from(crmHouseholdContacts)
    .innerJoin(clients, eq(clients.crmHouseholdId, crmHouseholdContacts.householdId))
    .where(
      and(
        eq(clients.firmId, firmId),
        ...(scope ? [scope] : []),
        or(
          ilike(crmHouseholdContacts.firstName, pattern),
          ilike(crmHouseholdContacts.lastName, pattern),
        ),
      ),
    );

  if (matchedHouseholdIds.length === 0) return [];

  const householdIds = matchedHouseholdIds.map((r) => r.householdId);

  const rows = await db
    .select(contactColumns)
    .from(clients)
    .innerJoin(
      crmHouseholdContacts,
      eq(crmHouseholdContacts.householdId, clients.crmHouseholdId),
    )
    .where(
      and(
        eq(clients.firmId, firmId),
        ...(scope ? [scope] : []),
        inArray(clients.crmHouseholdId, householdIds),
        or(
          eq(crmHouseholdContacts.role, "primary"),
          eq(crmHouseholdContacts.role, "spouse"),
        ),
      ),
    );

  return toSearchResults(rows).slice(0, MAX_RESULTS);
}

/**
 * The same recipient summary the typeahead returns, for one already-known
 * client id. Powers `/data-collection?clientId=…`, where the sender arrives
 * with the household already chosen and only needs it addressed.
 *
 * Returns null when the id isn't a client of this firm, isn't visible to the
 * caller, or has no primary contact — the sender then falls back to its blank
 * prospect form rather than failing the page.
 */
export async function findClientRecipient(
  clientId: string,
  firmId: string,
  caller: { userId: string; orgRole: string | null | undefined },
): Promise<ClientSearchResult | null> {
  // The id arrives from a query string and `clients.id` is a uuid column —
  // Postgres raises on a malformed value rather than returning no rows.
  if (!uuidRegex.test(clientId)) return null;

  const visible = await resolveVisibleAdvisorIds(caller.userId, caller.orgRole, firmId);
  const scope = advisorScopeCondition(clients.advisorId, visible);

  const rows = await db
    .select(contactColumns)
    .from(clients)
    .innerJoin(
      crmHouseholdContacts,
      eq(crmHouseholdContacts.householdId, clients.crmHouseholdId),
    )
    .where(
      and(
        eq(clients.id, clientId),
        eq(clients.firmId, firmId),
        ...(scope ? [scope] : []),
        or(
          eq(crmHouseholdContacts.role, "primary"),
          eq(crmHouseholdContacts.role, "spouse"),
        ),
      ),
    );

  return toSearchResults(rows)[0] ?? null;
}

export async function countClientsForFirm(firmId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clients)
    .where(eq(clients.firmId, firmId));
  return row?.count ?? 0;
}
