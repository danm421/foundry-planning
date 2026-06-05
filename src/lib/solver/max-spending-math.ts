//
// Pure helpers for the maximum-sustainable-spending solver. No engine/DB imports.
import type { ClientData } from "@/engine/types";
import { isRetirementLivingExpense } from "./living-expense";

/** Round a dollar amount to the nearest $2,000 (per spec). */
export function roundToNearest2k(amount: number): number {
  return Math.round(amount / 2000) * 2000;
}

/**
 * The plan's stated annual retirement living spend, in its input ("today's")
 * dollars: the sum of annualAmount across living expenses that begin after the
 * plan start year (the same set the `living-expense-scale` solver lever scales).
 */
export function retirementLivingExpenseTotal(tree: ClientData): number {
  const planStartYear = tree.planSettings.planStartYear;
  return tree.expenses
    .filter((e) => isRetirementLivingExpense(e, planStartYear))
    .reduce((sum, e) => sum + e.annualAmount, 0);
}
