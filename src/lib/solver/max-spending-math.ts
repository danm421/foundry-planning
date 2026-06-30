//
// Pure helpers for the maximum-sustainable-spending solver. No engine/DB imports.
import type { ClientData } from "@/engine/types";
import { isRetirementLivingExpense } from "./living-expense";

/** Round a dollar amount to the nearest $5,000. */
export function roundToNearest5k(amount: number): number {
  return Math.round(amount / 5000) * 5000;
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
