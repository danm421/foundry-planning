// src/lib/goals.ts

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
