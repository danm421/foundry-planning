// src/lib/investments/value-snapshots.ts
//
// Balance-snapshot pipeline: compute Σ holdingMarketValue per account and
// upsert one row per (accountId, asOfDate) into account_value_snapshots.
// Task 7 will extend this file with loadInvestmentSeries.
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountHoldings, accountValueSnapshots } from "@/db/schema";
import { holdingMarketValue } from "@/lib/investments/holdings-rollup";
import type { TrendPoint } from "@/lib/portal/networth-trend";

/**
 * Compute Σ holdingMarketValue for each account and upsert one
 * (accountId, asOfDate) row into account_value_snapshots.
 *
 * asOfDate is injected (no Date.now() inside) so callers can back-fill
 * and tests can be deterministic.
 *
 * Returns the number of rows written (one per accountId).
 */
export async function snapshotInvestmentValues(
  accountIds: string[],
  asOfDate: string,
): Promise<number> {
  if (accountIds.length === 0) return 0;

  const rows = await db
    .select({
      accountId: accountHoldings.accountId,
      shares: accountHoldings.shares,
      price: accountHoldings.price,
      marketValue: accountHoldings.marketValue,
    })
    .from(accountHoldings)
    .where(inArray(accountHoldings.accountId, accountIds));

  // Aggregate Σ holdingMarketValue per account.
  const totals = new Map<string, number>();
  for (const r of rows) {
    const mv = holdingMarketValue({
      marketValue: r.marketValue != null ? Number(r.marketValue) : null,
      shares: Number(r.shares),
      price: Number(r.price),
    });
    if (Number.isFinite(mv)) {
      totals.set(r.accountId, (totals.get(r.accountId) ?? 0) + mv);
    }
  }

  // Upsert one snapshot per accountId (conflict = same day → update value).
  let written = 0;
  for (const accountId of accountIds) {
    const value = (totals.get(accountId) ?? 0).toFixed(2);
    await db
      .insert(accountValueSnapshots)
      .values({ accountId, asOfDate, value })
      .onConflictDoUpdate({
        target: [accountValueSnapshots.accountId, accountValueSnapshots.asOfDate],
        set: { value },
      });
    written += 1;
  }
  return written;
}

/** Per-account ascending TrendPoint series + a per-date summed total. */
export async function loadInvestmentSeries(
  accountIds: string[],
): Promise<{ perAccount: Map<string, TrendPoint[]>; total: TrendPoint[] }> {
  const perAccount = new Map<string, TrendPoint[]>();
  if (accountIds.length === 0) return { perAccount, total: [] };
  const snaps = await db
    .select({ accountId: accountValueSnapshots.accountId, date: accountValueSnapshots.asOfDate, value: accountValueSnapshots.value })
    .from(accountValueSnapshots)
    .where(inArray(accountValueSnapshots.accountId, accountIds));

  const totalByDate = new Map<string, number>();
  for (const s of snaps) {
    const list = perAccount.get(s.accountId) ?? [];
    list.push({ date: s.date, netWorth: Number(s.value) });
    perAccount.set(s.accountId, list);
    totalByDate.set(s.date, (totalByDate.get(s.date) ?? 0) + Number(s.value));
  }
  for (const list of perAccount.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = [...totalByDate.entries()]
    .map(([date, netWorth]) => ({ date, netWorth }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { perAccount, total };
}
