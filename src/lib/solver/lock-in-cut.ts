import type { Expense } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { isRetirementLivingExpense } from "@/lib/solver/living-expense";

/**
 * Build `expense-annual-amount` mutations that lower the household's
 * working-years living expenses by `reduceBy` (current-year dollars),
 * distributed across the living rows active in `currentYear` that are NOT
 * retirement living rows. Retirement spending is intentionally untouched.
 *
 * Note: if a single living row spans both working and retirement years, this
 * scales that row for its whole horizon — retirement spend would drop too. In
 * the common case (separate working vs. retirement living rows) it does not.
 */
export function buildLockInCutMutations(
  expenses: Expense[],
  planStartYear: number,
  currentYear: number,
  reduceBy: number,
): SolverMutation[] {
  if (reduceBy <= 0) return [];
  const rows = expenses.filter(
    (e) =>
      e.type === "living" &&
      e.startYear <= currentYear &&
      currentYear <= e.endYear &&
      !isRetirementLivingExpense(e, planStartYear),
  );
  const total = rows.reduce((s, e) => s + e.annualAmount, 0);
  if (rows.length === 0 || total <= 0) return [];
  return rows.map((e) => {
    const share = (e.annualAmount / total) * reduceBy;
    const next = Math.max(0, Math.round(e.annualAmount - share));
    return { kind: "expense-annual-amount", expenseId: e.id, annualAmount: next };
  });
}
