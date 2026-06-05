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

import type { ClientData, Expense } from "@/engine/types";

export function isRetirementLivingExpense(
  e: Expense,
  planStartYear: number,
): boolean {
  return e.type === "living" && e.startYear > planStartYear;
}

/** Round a dollar amount to the nearest $2,000. */
export function roundToNearest2k(amount: number): number {
  return Math.round(amount / 2000) * 2000;
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
 * Adjust a solved scale factor so the resulting annual retirement living-expense
 * total (`scale * baseTotal`) lands on the nearest $2,000. Returns the scale
 * unchanged when `baseTotal` is 0 (nothing to scale; avoids divide-by-zero).
 */
export function snapScaleToNearest2k(scale: number, baseTotal: number): number {
  if (baseTotal <= 0) return scale;
  return roundToNearest2k(scale * baseTotal) / baseTotal;
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
