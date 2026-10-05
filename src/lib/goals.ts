// src/lib/goals.ts

import {
  canHaveGoalFunding,
  is529Account,
  type GoalFundingAccountLike,
} from "@/engine/goals/goal-funding";

export { canHaveGoalFunding, is529Account };

/** The subset of an expense the goal test needs — engine rows, view rows, and
 *  the Household Map's `GoalExpense` all satisfy it. */
export interface GoalFlaggedExpense {
  type: string;
  isGoal?: boolean;
}

/**
 * Education is always a goal; every other expense opts in via the `isGoal`
 * flag. One definition, because three surfaces answer this question — the
 * Household Map's Goals board, the wizard's Goals step, and the wizard step
 * status — and a drift between them would show the advisor a different set of
 * goals in each place.
 */
export function isGoalExpense(e: GoalFlaggedExpense): boolean {
  return e.type === "education" || e.isGoal === true;
}

/** Funding starts the year the beneficiary turns this age. */
export const EDUCATION_GOAL_START_AGE = 18;

/** Length of the default programme, in funded years. */
export const EDUCATION_GOAL_YEARS = 4;

/**
 * Default start/end years for an education goal, from the beneficiary's birth
 * year: a four-year programme beginning the year they turn 18, or `firstYear`
 * when that birthday has already passed — a beneficiary who is already 18 or
 * older starts funding now rather than in the past.
 *
 * Both ends are INCLUSIVE, the way the engine reads an expense
 * (`year >= startYear && year <= endYear`), so four years is `start + 3`.
 *
 * One definition because two surfaces auto-fill these dates — the expense
 * dialog in `income-expenses-view.tsx` (also the guided walkthrough's Goals
 * step) and the Household Map's quick-edit drawer — and a goal added in one
 * place has to land on the same years as one added in the other. `firstYear` is
 * the caller's floor: the current year in the dialog, the plan's first year on
 * the Map.
 */
export function educationGoalYears(
  birthYear: number,
  firstYear: number,
): { startYear: number; endYear: number } {
  const startYear = Math.max(firstYear, birthYear + EDUCATION_GOAL_START_AGE);
  return { startYear, endYear: startYear + EDUCATION_GOAL_YEARS - 1 };
}

export const GOAL_FUNDING_NOT_A_GOAL_ERROR =
  "Only education goals and Other expenses marked “Show as a goal” can draw from savings accounts.";
export const GOAL_FUNDING_529_ERROR = "A 529 plan can only pay for an education goal.";

/**
 * Why this expense may not carry these savings accounts, or null when it may.
 * One rule for every save path (spec 2026-10-05-solver-goals-design, §2): only
 * a goal (`canHaveGoalFunding`) carries accounts, and a 529 pays only for
 * education — the projection treats every 529 draw as tax-free.
 */
export function goalFundingError(
  row: { type: string; isGoal?: boolean },
  dedicatedAccounts: readonly GoalFundingAccountLike[],
): string | null {
  if (dedicatedAccounts.length === 0) return null;
  if (!canHaveGoalFunding(row)) return GOAL_FUNDING_NOT_A_GOAL_ERROR;
  if (row.type !== "education" && dedicatedAccounts.some(is529Account)) return GOAL_FUNDING_529_ERROR;
  return null;
}

/**
 * "Pay shortfall out of pocket" for a goal that has never had savings
 * accounts. Off for education (unchanged). On for an Other goal, which today
 * is paid in full from cash flow — attaching a savings account must not
 * silently leave the rest unpaid (spec Decision 3).
 */
export function defaultPayShortfallOutOfPocket(row: { type: string; isGoal?: boolean }): boolean {
  return row.type === "other" && row.isGoal === true;
}
