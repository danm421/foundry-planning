// src/lib/integrations/reviews.ts
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientImports, clients, crmHouseholds } from "@/db/schema";
import type { ProviderId } from "./types";

export type OpenReview = {
  importId: string;
  clientId: string;
  householdName: string;
  accountCount: number;
};

/**
 * The firm's synced accounts still waiting for an advisor — one row per client,
 * since syncFirm folds every pull into a single open `review` import per
 * client. The integration page lists these so the advisor can reach the review
 * without knowing it lives under the client's Details → Import.
 */
export async function listOpenReviews(firmId: string, providerId: ProviderId): Promise<OpenReview[]> {
  // Credentials-only — never writes an import. Checking the id (not
  // `provider.syncs`) narrows it to import_origin's enum, as in syncFirm.
  if (providerId === "azure_openai") return [];

  return db
    .select({
      importId: clientImports.id,
      clientId: clientImports.clientId,
      householdName: crmHouseholds.name,
      accountCount: sql<number>`coalesce(jsonb_array_length(${clientImports.payloadJson}->'payload'->'accounts'), 0)::int`,
    })
    .from(clientImports)
    .innerJoin(clients, eq(clients.id, clientImports.clientId))
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .where(
      and(
        eq(clientImports.orgId, firmId),
        eq(clients.firmId, firmId),
        eq(clientImports.origin, providerId),
        eq(clientImports.status, "review"),
        isNull(crmHouseholds.deletedAt),
      ),
    )
    .orderBy(asc(crmHouseholds.name));
}
