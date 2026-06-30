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
// the plan. Without this the solver can't see the real retirement row, scales a
// synthesized duplicate instead, and the PoS solve reports "unreachable" at $0.

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
  // into the plan — otherwise the solver can't see the real row, synthesizes a
  // duplicate on top of it, and the PoS solve returns "unreachable" at $0.
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

/**
 * Build a fresh retirement-phase "living" expense for the given annual amount.
 * Used by the absolute-dollar living-expense solve when the plan has no
 * retirement living-expense row to scale. Year windows are expressed as refs
 * (`client_retirement` → `plan_end`); applyMutations runs resolveRefYears at the
 * end, which fills concrete startYear/endYear. Concrete years are seeded here as
 * a best-effort fallback for any consumer that reads them before resolution.
 */
export function synthesizeRetirementLivingExpense(
  tree: ClientData,
  amount: number,
): Expense {
  const { planStartYear, planEndYear, inflationRate } = tree.planSettings;
  return {
    id: crypto.randomUUID(),
    type: "living",
    name: "Retirement Living Expenses",
    annualAmount: amount,
    startYear: planStartYear + 1,
    endYear: planEndYear,
    growthRate: inflationRate,
    startYearRef: "client_retirement",
    endYearRef: "plan_end",
    source: "manual",
  };
}

/** A consumer-agnostic plan for applying a `living-expense-amount` mutation:
 *  either update existing retirement rows to new annual amounts, or synthesize
 *  a fresh retirement row when none exist. The three consumers (apply-mutations,
 *  base-updates, scenario-changes) each render this plan into their own output. */
export type LivingExpenseAmountPlan =
  | { kind: "update"; rows: { id: string; from: number; to: number }[] }
  | { kind: "synthesize"; expense: Expense };

/** Decide how to reach an absolute annual retirement living-expense `amount`:
 *  proportional scale when retirement rows exist with positive sum, even-split
 *  when they exist but sum to $0, or synthesize one row when none exist. */
export function planLivingExpenseAmount(
  tree: ClientData,
  amount: number,
): LivingExpenseAmountPlan {
  const planStartYear = tree.planSettings.planStartYear;
  const retirement = (tree.expenses ?? []).filter((e) =>
    isRetirementLivingExpense(e, planStartYear),
  );
  if (retirement.length === 0) {
    return { kind: "synthesize", expense: synthesizeRetirementLivingExpense(tree, amount) };
  }
  const baseSum = retirement.reduce((s, e) => s + e.annualAmount, 0);
  const rows = retirement.map((e) => ({
    id: e.id,
    from: e.annualAmount,
    to: baseSum > 0 ? e.annualAmount * (amount / baseSum) : amount / retirement.length,
  }));
  return { kind: "update", rows };
}
