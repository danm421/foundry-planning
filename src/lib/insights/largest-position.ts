// src/lib/insights/largest-position.ts
import { db } from "@/db";
import { accountHoldings, accounts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { resolveScenarioId } from "@/lib/compute-cache/resolve-scenario-id";
import { holdingMarketValue } from "@/lib/investments/holdings-rollup";

export interface PositionRow {
  ticker: string | null;
  name: string | null;
  marketValue: number | null;
  shares: number;
  price: number;
}

/**
 * Largest single position by aggregated market value. Pure.
 *
 * Aggregates across accounts: the same ticker held three times is ONE
 * concentration. Value comes from `holdingMarketValue`, never raw
 * shares x price — bonds and manual holdings carry an authoritative
 * marketValue because a bond's price quotes per $100 par.
 */
export function pickLargestPosition(
  rows: readonly PositionRow[],
): { label: string; value: number } | null {
  const byLabel = new Map<string, number>();
  for (const r of rows) {
    const label = r.ticker ?? r.name;
    if (!label) continue; // nothing to name it by; not a reportable position
    const value = holdingMarketValue({
      marketValue: r.marketValue,
      shares: r.shares,
      price: r.price,
    });
    byLabel.set(label, (byLabel.get(label) ?? 0) + value);
  }
  let best: { label: string; value: number } | null = null;
  for (const [label, value] of byLabel) {
    if (!best || value > best.value) best = { label, value };
  }
  return best;
}

/**
 * Load the household's BASE-scenario holdings, then the pure pick.
 *
 * `accounts` is scoped by `clientId` AND `scenarioId` — it has no `firmId`
 * column. Selecting on clientId alone would sweep every scenario the household
 * has and count the same position once per scenario, inflating concentration
 * for exactly the households that model the most alternatives. The client row
 * was already firm-checked at the top of `loadInsightsBattery`, so clientId +
 * scenarioId is the correct and sufficient scope.
 *
 * Fail-soft, like every other leg of the battery's Promise.all. A household
 * with no base scenario makes `resolveScenarioId` throw, and `getOverviewData`
 * does NOT throw first for that household — it re-throws only
 * ClientNotFoundError and swallows the rest into `projectionError`. An
 * un-caught throw here would therefore 500 the entire 360 tab for a household
 * that until now rendered a degraded-but-working view. Having no concentration
 * figure is not a reason to break the whole 360.
 */
export async function largestPosition(
  clientId: string,
): Promise<{ label: string; value: number } | null> {
  try {
    const baseScenarioId = await resolveScenarioId(clientId, "base");
    const accountRows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, baseScenarioId)),
      );
    if (accountRows.length === 0) return null;

    const rows = await db
      .select({
        ticker: accountHoldings.displayTicker,
        name: accountHoldings.displayName,
        marketValue: accountHoldings.marketValue,
        shares: accountHoldings.shares,
        price: accountHoldings.price,
      })
      .from(accountHoldings)
      .where(inArray(accountHoldings.accountId, accountRows.map((a) => a.id)));

    return pickLargestPosition(
      rows.map((r) => ({
        ticker: r.ticker,
        name: r.name,
        marketValue: r.marketValue != null ? Number(r.marketValue) : null,
        shares: Number(r.shares),
        price: Number(r.price),
      })),
    );
  } catch (err) {
    console.error("[insights] largest position load failed (non-fatal):", err);
    return null;
  }
}
