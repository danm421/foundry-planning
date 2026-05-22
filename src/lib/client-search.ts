import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";

export interface ClientSearchResult {
  id: string;
  householdTitle: string;
}

const MAX_RESULTS = 8;

export async function searchClients(
  query: string,
  firmId: string,
): Promise<ClientSearchResult[]> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];

  const pattern = `%${trimmed}%`;

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
        or(
          ilike(crmHouseholdContacts.firstName, pattern),
          ilike(crmHouseholdContacts.lastName, pattern),
        ),
      ),
    );

  if (matchedHouseholdIds.length === 0) return [];

  const householdIds = matchedHouseholdIds.map((r) => r.householdId);

  const rows = await db
    .select({
      id: clients.id,
      contactRole: crmHouseholdContacts.role,
      contactFirstName: crmHouseholdContacts.firstName,
      contactLastName: crmHouseholdContacts.lastName,
    })
    .from(clients)
    .innerJoin(
      crmHouseholdContacts,
      eq(crmHouseholdContacts.householdId, clients.crmHouseholdId),
    )
    .where(
      and(
        eq(clients.firmId, firmId),
        inArray(clients.crmHouseholdId, householdIds),
        or(
          eq(crmHouseholdContacts.role, "primary"),
          eq(crmHouseholdContacts.role, "spouse"),
        ),
      ),
    );

  const byClient = new Map<
    string,
    {
      id: string;
      primary: { firstName: string; lastName: string } | null;
      spouse: { firstName: string; lastName: string } | null;
    }
  >();
  for (const row of rows) {
    const entry = byClient.get(row.id) ?? {
      id: row.id,
      primary: null,
      spouse: null,
    };
    if (row.contactRole === "primary") {
      entry.primary = { firstName: row.contactFirstName, lastName: row.contactLastName };
    } else if (row.contactRole === "spouse") {
      entry.spouse = { firstName: row.contactFirstName, lastName: row.contactLastName };
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
    results.push({ id: entry.id, householdTitle });
  }
  results.sort((a, b) => a.householdTitle.localeCompare(b.householdTitle));
  return results.slice(0, MAX_RESULTS);
}

export async function countClientsForFirm(firmId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clients)
    .where(eq(clients.firmId, firmId));
  return row?.count ?? 0;
}
