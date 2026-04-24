import { db } from "@/db";
import { clients } from "@/db/schema";
import { and, eq, ilike, or, sql } from "drizzle-orm";

export interface ClientSearchResult {
  id: string;
  householdTitle: string;
}

function buildHouseholdTitle(row: {
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}): string {
  if (row.spouseName) {
    const spouseLast = row.spouseLastName ?? row.lastName;
    return `${row.firstName} & ${row.spouseName} ${spouseLast}`.trim();
  }
  return `${row.firstName} ${row.lastName}`.trim();
}

const MAX_RESULTS = 8;

export async function searchClients(
  query: string,
  firmId: string,
): Promise<ClientSearchResult[]> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];

  const pattern = `%${trimmed}%`;

  const rows = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      spouseName: clients.spouseName,
      spouseLastName: clients.spouseLastName,
    })
    .from(clients)
    .where(
      and(
        eq(clients.firmId, firmId),
        or(
          ilike(clients.firstName, pattern),
          ilike(clients.lastName, pattern),
          ilike(clients.spouseName, pattern),
          ilike(clients.spouseLastName, pattern),
        ),
      ),
    )
    .orderBy(clients.lastName, clients.firstName)
    .limit(MAX_RESULTS);

  return rows.map((row) => ({
    id: row.id,
    householdTitle: buildHouseholdTitle(row),
  }));
}

export async function countClientsForFirm(firmId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clients)
    .where(eq(clients.firmId, firmId));
  return row?.count ?? 0;
}
