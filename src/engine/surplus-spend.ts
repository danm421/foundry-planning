// Per-year surplus spend rate.
//
// `surplusSpendPct` is a flat assumption applied to every projection year.
// `surplusSpendAllUntilRetirement` overrides it to 100% for every year strictly
// before the household's FIRST retirement year, modeling the common advisor
// assumption that working-years surplus is absorbed by lifestyle rather than
// quietly compounding into the portfolio. From the retirement year onward the
// stored percentage applies unchanged.

import { firstRetirementYear, itemProrationGate } from "./retirement-proration";
import type { ClientInfo, Expense, PlanSettings } from "./types";

export function effectiveSurplusSpendPct(
  planSettings: PlanSettings,
  client: ClientInfo,
  year: number,
): number {
  const stored = Math.min(1, Math.max(0, planSettings.surplusSpendPct ?? 0));
  if (!planSettings.surplusSpendAllUntilRetirement) return stored;
  const retYear = firstRetirementYear(client);
  // Nothing to anchor to (no parseable DOB) — never silently force 100%.
  if (retYear == null) return stored;
  return year < retYear ? 1 : stored;
}

/**
 * The living-expense row, if any, that spends the household's entire remaining
 * cash flow in `year`.
 *
 * Mirrors the filter `computeExpenses` is called with in projection.ts: an
 * entity- or business-owned row is not paid from household cash, so it must
 * never absorb household leftover. The write layer permits at most one
 * absorbing row per (client, scenario); if older data yields several, take the
 * earliest-starting one deterministically rather than double-spending.
 */
export function absorbingLivingRow(
  expenses: Expense[],
  year: number,
  client: ClientInfo,
): Expense | null {
  let winner: Expense | null = null;
  for (const e of expenses) {
    if (e.type !== "living") continue;
    if (e.absorbsRemainingCashFlow !== true) continue;
    if (e.ownerEntityId != null || e.ownerAccountId != null) continue;
    if (!itemProrationGate(e, year, client).include) continue;
    if (winner == null || e.startYear < winner.startYear) winner = e;
  }
  return winner;
}
