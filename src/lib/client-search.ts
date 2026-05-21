import { db } from "@/db";
import { clients, crmHouseholdContacts, crmHouseholds } from "@/db/schema";
import { and, eq, ilike, or, sql } from "drizzle-orm";

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

  // Search by CRM contact names (source of truth). Fall back to clients.*
  // columns for households that haven't been linked yet.
  const rows = await db
    .select({
      id: clients.id,
      legacyFirstName: clients.firstName,
      legacyLastName: clients.lastName,
      legacySpouseName: clients.spouseName,
      legacySpouseLastName: clients.spouseLastName,
      contactRole: crmHouseholdContacts.role,
      contactFirstName: crmHouseholdContacts.firstName,
      contactLastName: crmHouseholdContacts.lastName,
    })
    .from(clients)
    .leftJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .leftJoin(
      crmHouseholdContacts,
      eq(crmHouseholdContacts.householdId, crmHouseholds.id),
    )
    .where(
      and(
        eq(clients.firmId, firmId),
        or(
          ilike(crmHouseholdContacts.firstName, pattern),
          ilike(crmHouseholdContacts.lastName, pattern),
          ilike(clients.firstName, pattern),
          ilike(clients.lastName, pattern),
          ilike(clients.spouseName, pattern),
          ilike(clients.spouseLastName, pattern),
        ),
      ),
    );

  // Collapse contact rows into one entry per client. Prefer CRM contacts when
  // present.
  const byClient = new Map<
    string,
    {
      id: string;
      primary: { firstName: string; lastName: string } | null;
      spouse: { firstName: string; lastName: string } | null;
      legacy: {
        firstName: string;
        lastName: string;
        spouseName: string | null;
        spouseLastName: string | null;
      };
    }
  >();
  for (const row of rows) {
    const entry = byClient.get(row.id) ?? {
      id: row.id,
      primary: null,
      spouse: null,
      legacy: {
        firstName: row.legacyFirstName,
        lastName: row.legacyLastName,
        spouseName: row.legacySpouseName,
        spouseLastName: row.legacySpouseLastName,
      },
    };
    if (row.contactRole === "primary" && row.contactFirstName && row.contactLastName) {
      entry.primary = { firstName: row.contactFirstName, lastName: row.contactLastName };
    } else if (row.contactRole === "spouse" && row.contactFirstName && row.contactLastName) {
      entry.spouse = { firstName: row.contactFirstName, lastName: row.contactLastName };
    }
    byClient.set(row.id, entry);
  }

  const results: ClientSearchResult[] = [];
  for (const entry of byClient.values()) {
    const firstName = entry.primary?.firstName ?? entry.legacy.firstName;
    const lastName = entry.primary?.lastName ?? entry.legacy.lastName;
    const spouseFirst = entry.spouse?.firstName ?? entry.legacy.spouseName;
    const spouseLast = entry.spouse?.lastName ?? entry.legacy.spouseLastName ?? lastName;
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
