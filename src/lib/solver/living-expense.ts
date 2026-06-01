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

import type { Expense } from "@/engine/types";

export function isRetirementLivingExpense(
  e: Expense,
  planStartYear: number,
): boolean {
  return e.type === "living" && e.startYear > planStartYear;
}
