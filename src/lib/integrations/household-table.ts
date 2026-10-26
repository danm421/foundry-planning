// src/lib/integrations/household-table.ts
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, scenarios } from "@/db/schema";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { SyncingProviderId } from "./types";

/** One external household as a connection's household table shows it. */
export type HouseholdTableRow = {
  id: string;
  name: string | null;
  /** This connection's link for the household, if it has one. */
  link: { linkId: string; clientId: string } | null;
  /** Who holds the household through another connection; null when it's free. */
  lockedBy: string | null;
  /** Connected of total accounts from the last pull; null when unlinked or never pulled. */
  accounts: { connected: number; total: number } | null;
};

/** Linked households first, then A–Z by name, with unnamed (id-only) households last in each group. */
export function sortHouseholdRows(rows: HouseholdTableRow[]): HouseholdTableRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(!a.link) - Number(!b.link) ||
      Number(!a.name) - Number(!b.name) ||
      (a.name && b.name ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : 0) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

/**
 * For each pulled link: how many of the last pull's accounts feed a plan
 * account in the client's base case (`connected`), of how many were pulled
 * (`total`). One query for every link. A link never pulled has no entry.
 */
export async function countConnectedAccounts(i: {
  providerId: SyncingProviderId;
  links: Array<{ id: string; clientId: string; lastPullAccounts: ExtractedAccount[] | null }>;
}): Promise<Map<string, { connected: number; total: number }>> {
  const counts = new Map<string, { connected: number; total: number }>();
  const pulled = i.links.filter((l) => l.lastPullAccounts !== null);
  if (pulled.length === 0) return counts;

  const tied = await db
    .select({ clientId: accounts.clientId, externalId: accounts.externalId })
    .from(accounts)
    .innerJoin(scenarios, eq(scenarios.id, accounts.scenarioId))
    .where(
      and(
        inArray(accounts.clientId, [...new Set(pulled.map((l) => l.clientId))]),
        eq(scenarios.isBaseCase, true),
        eq(accounts.externalProvider, i.providerId),
        isNotNull(accounts.externalId),
      ),
    );
  const tiedIds = new Set(tied.map((t) => `${t.clientId}:${t.externalId}`));

  for (const link of pulled) {
    const pulledAccounts = link.lastPullAccounts ?? [];
    counts.set(link.id, {
      connected: pulledAccounts.filter((a) => a.externalId && tiedIds.has(`${link.clientId}:${a.externalId}`))
        .length,
      total: pulledAccounts.length,
    });
  }
  return counts;
}
