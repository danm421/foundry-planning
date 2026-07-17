import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, crmHouseholds, scenarios } from "@/db/schema";
import { aumBookWhere, visibleHouseholdConditions } from "./scope";

/** Which tile the advisor clicked to reach the page. */
export type BookFocus = "book" | "held-away";

/** One raw account row from the book query, pre-aggregation. */
export interface BookQueryRow {
  householdId: string;
  householdName: string;
  accountId: string;
  accountName: string;
  category: string;
  /** decimal(15,2) as a string from Postgres. */
  value: string;
  countsTowardAum: boolean;
}

export interface BookAccountRow {
  accountId: string;
  name: string;
  category: string;
  value: number;
  countsTowardAum: boolean;
}

export interface BookHouseholdRow {
  householdId: string;
  householdName: string;
  bookValue: number;
  heldAway: number;
  total: number;
  accounts: BookAccountRow[];
}

export interface BookBreakdown {
  households: BookHouseholdRow[];
  totals: {
    bookValue: number;
    heldAway: number;
    total: number;
    heldAwayAccounts: number;
    householdCount: number;
  };
  concentration: {
    top5BookSharePct: number;
    largestHeldAway: { householdName: string; value: number } | null;
    heldAwayHouseholdCount: number;
  };
}

/**
 * Fold raw account rows into per-household book/held-away totals plus firm-wide
 * totals and concentration stats. Pure — no DB, no clock. Sums integer cents so
 * the totals stay exact and match the SQL-aggregated KPI tiles.
 */
export function aggregateBookBreakdown(rows: BookQueryRow[]): BookBreakdown {
  const byHousehold = new Map<
    string,
    { householdName: string; bookCents: number; heldAwayCents: number; accounts: BookAccountRow[] }
  >();
  let heldAwayAccounts = 0;

  for (const r of rows) {
    const cents = Math.round(Number(r.value) * 100);
    let hh = byHousehold.get(r.householdId);
    if (!hh) {
      hh = { householdName: r.householdName, bookCents: 0, heldAwayCents: 0, accounts: [] };
      byHousehold.set(r.householdId, hh);
    }
    if (r.countsTowardAum) hh.bookCents += cents;
    else {
      hh.heldAwayCents += cents;
      heldAwayAccounts += 1;
    }
    hh.accounts.push({
      accountId: r.accountId,
      name: r.accountName,
      category: r.category,
      value: cents / 100,
      countsTowardAum: r.countsTowardAum,
    });
  }

  const households: BookHouseholdRow[] = [...byHousehold.entries()].map(([householdId, h]) => ({
    householdId,
    householdName: h.householdName,
    bookValue: h.bookCents / 100,
    heldAway: h.heldAwayCents / 100,
    total: (h.bookCents + h.heldAwayCents) / 100,
    accounts: h.accounts,
  }));

  // Deterministic default order: total desc, then name asc.
  households.sort(
    (a, b) => b.total - a.total || a.householdName.localeCompare(b.householdName),
  );

  const bookCentsTotal = [...byHousehold.values()].reduce((s, h) => s + h.bookCents, 0);
  const heldAwayCentsTotal = [...byHousehold.values()].reduce((s, h) => s + h.heldAwayCents, 0);

  const top5BookCents = [...households]
    .sort((a, b) => b.bookValue - a.bookValue)
    .slice(0, 5)
    .reduce((s, h) => s + Math.round(h.bookValue * 100), 0);

  const largest = households
    .filter((h) => h.heldAway > 0)
    .reduce<BookHouseholdRow | null>(
      (best, h) => (best === null || h.heldAway > best.heldAway ? h : best),
      null,
    );

  return {
    households,
    totals: {
      bookValue: bookCentsTotal / 100,
      heldAway: heldAwayCentsTotal / 100,
      total: (bookCentsTotal + heldAwayCentsTotal) / 100,
      heldAwayAccounts,
      householdCount: households.length,
    },
    concentration: {
      top5BookSharePct: bookCentsTotal > 0 ? (top5BookCents / bookCentsTotal) * 100 : 0,
      largestHeldAway: largest
        ? { householdName: largest.householdName, value: largest.heldAway }
        : null,
      heldAwayHouseholdCount: households.filter((h) => h.heldAway > 0).length,
    },
  };
}

/**
 * Per-household book value + held-away breakdown for the advisor's visible book.
 * One query (all base-case, AUM-eligible accounts joined to household), then the
 * pure aggregator. Shares `aumBookWhere` + the base-case join with getBookKpis,
 * so `totals.bookValue` / `totals.heldAway` equal the /home tiles by construction.
 */
export async function getBookBreakdown(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
): Promise<BookBreakdown> {
  const hhConditions = await visibleHouseholdConditions(firmId, userId, orgRole);
  const rows = await db
    .select({
      householdId: crmHouseholds.id,
      householdName: crmHouseholds.name,
      accountId: accounts.id,
      accountName: accounts.name,
      category: accounts.category,
      value: accounts.value,
      countsTowardAum: accounts.countsTowardAum,
    })
    .from(accounts)
    .innerJoin(
      scenarios,
      and(eq(accounts.scenarioId, scenarios.id), eq(scenarios.isBaseCase, true)),
    )
    .innerJoin(clients, eq(accounts.clientId, clients.id))
    .innerJoin(crmHouseholds, eq(clients.crmHouseholdId, crmHouseholds.id))
    .where(aumBookWhere(hhConditions));
  return aggregateBookBreakdown(rows);
}
