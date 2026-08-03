// src/lib/solver/living-expense.ts
//
// The `living-expense-scale` solver lever targets RETIREMENT living expenses
// only. Current (working-year) living expenses are always exactly what the
// advisor typed in — the solver never moves them.
//
// A living expense counts as "retirement" when its window begins after the
// plan's start year. The seeded "Current Living Expenses" row is anchored to
// `plan_start` (startYear === planStartYear), while "Retirement Living
// Expenses" is anchored to `client_retirement` (startYear > planStartYear).
// This mirrors the current/retirement split the solver UI shows via labelFor()
// in solver-row-living-expense-scale.tsx.
//
// EXCEPTION — already-retired clients: when both spouses have already retired,
// `client_retirement` resolves to a PAST year, so the retirement row's startYear
// lands <= plan start and the "begins after plan start" test misses it. We then
// also accept a row anchored to client/spouse retirement that stays active into
// the plan. Without this the solver can't see the real retirement row: there is
// no synthesize fallback to fall back on (removed — see planLivingExpenseAmount
// below), so `living-expense-scale` silently leaves the row untouched and
// `living-expense-amount` silently no-ops (solve-max-spending.ts's
// no-retirement-row guard then reports the plan's actual PoS instead of a
// fabricated "solved" spend). No error, just an inert lever — this exception
// clause is what keeps that from happening for real already-retired clients.

import type { ClientData, Expense } from "@/engine/types";

export function isRetirementLivingExpense(
  e: Expense,
  planStartYear: number,
): boolean {
  if (e.type !== "living") return false;
  // Not-yet-retired clients: the retirement living expense begins in a future
  // year (anchored to client/spouse retirement, which resolves > plan start).
  if (e.startYear > planStartYear) return true;
  // Already-retired clients: retirement is in the PAST, so the retirement
  // living-expense row resolves to a startYear <= plan start and the test above
  // misses it. Recognize it by its retirement anchor as long as it stays active
  // into the plan — otherwise the solver can't see the real row and both living-
  // expense levers silently do nothing to it (no synthesize fallback exists to
  // paper over the miss; see the header comment above).
  const startsAtRetirement =
    e.startYearRef === "client_retirement" ||
    e.startYearRef === "spouse_retirement";
  return startsAtRetirement && e.endYear >= planStartYear;
}

/** Round a dollar amount to the nearest $5,000. */
export function roundToNearest5k(amount: number): number {
  return Math.round(amount / 5000) * 5000;
}

/**
 * The plan's stated annual retirement living spend, in its input ("today's")
 * dollars: the sum of annualAmount across the living expenses the
 * `living-expense-scale` lever scales (those beginning after plan start).
 */
export function retirementLivingExpenseTotal(tree: ClientData): number {
  const planStartYear = tree.planSettings.planStartYear;
  return tree.expenses
    .filter((e) => isRetirementLivingExpense(e, planStartYear))
    .reduce((sum, e) => sum + e.annualAmount, 0);
}

/** A consumer-agnostic plan for applying a `living-expense-amount` mutation:
 *  update the existing retirement rows to new annual amounts.
 *
 *  There is deliberately NO "synthesize" arm. Living expenses are a closed set
 *  of two seeded rows (see lib/living-expenses.ts), so a tree with no
 *  retirement row is a broken invariant, not a case to paper over. The old
 *  synthesize arm was persisted by mutations-to-base-updates and
 *  mutations-to-scenario-changes WITHOUT passing through expenses-writes.ts,
 *  which made the solver a way to mint a third living row. An empty plan does
 *  nothing visible instead. */
export type LivingExpenseAmountPlan = {
  kind: "update";
  rows: { id: string; from: number; to: number }[];
};

/** Decide how to reach an absolute annual retirement living-expense `amount`:
 *  proportional scale when retirement rows exist with a positive sum,
 *  even-split when they exist but sum to $0, no-op when none exist. */
export function planLivingExpenseAmount(
  tree: ClientData,
  amount: number,
): LivingExpenseAmountPlan {
  const planStartYear = tree.planSettings.planStartYear;
  const retirement = (tree.expenses ?? []).filter((e) =>
    isRetirementLivingExpense(e, planStartYear),
  );
  if (retirement.length === 0) return { kind: "update", rows: [] };
  const baseSum = retirement.reduce((s, e) => s + e.annualAmount, 0);
  const rows = retirement.map((e) => ({
    id: e.id,
    from: e.annualAmount,
    to: baseSum > 0 ? e.annualAmount * (amount / baseSum) : amount / retirement.length,
  }));
  return { kind: "update", rows };
}
