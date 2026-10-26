// src/lib/integrations/reviews.ts
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientImports, clients, crmHouseholds, integrationHouseholdLinks } from "@/db/schema";

export type OpenReview = {
  importId: string;
  clientId: string;
  householdName: string;
  accountCount: number;
};

/**
 * One connection's synced accounts still waiting for an advisor — one row per
 * client, since a sync folds every pull into a single open `review` import per
 * client. A client belongs to the connection that links it, so a colleague's
 * reviews never show here. The connection page lists these so the advisor can
 * reach the review without knowing it lives under the client's Details → Import.
 * The caller has already established that the connection is theirs.
 */
export async function listOpenReviews(connectionId: string): Promise<OpenReview[]> {
  return db
    .select({
      importId: clientImports.id,
      clientId: clientImports.clientId,
      householdName: crmHouseholds.name,
      accountCount: sql<number>`coalesce(jsonb_array_length(${clientImports.payloadJson}->'payload'->'accounts'), 0)::int`,
    })
    .from(clientImports)
    .innerJoin(
      integrationHouseholdLinks,
      eq(integrationHouseholdLinks.clientId, clientImports.clientId),
    )
    .innerJoin(clients, eq(clients.id, clientImports.clientId))
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .where(
      and(
        eq(integrationHouseholdLinks.connectionId, connectionId),
        eq(clientImports.orgId, integrationHouseholdLinks.firmId),
        eq(clients.firmId, integrationHouseholdLinks.firmId),
        // Two different enums, so compare as text.
        sql`${clientImports.origin}::text = ${integrationHouseholdLinks.provider}::text`,
        eq(clientImports.status, "review"),
        isNull(crmHouseholds.deletedAt),
      ),
    )
    .orderBy(asc(crmHouseholds.name));
}
