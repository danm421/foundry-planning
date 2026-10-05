/** Pure goal-funding math and rules: which expenses the projection funds from
 *  dedicated savings accounts, which of those accounts a goal may draw, and the
 *  draw itself (preferred-first, capped at each balance, reporting the
 *  uncovered shortfall + aggregated taxable components). Framework-free.
 *  Spec: 2026-10-05-solver-goals-design.
 */

/** The fields of an account the goal-funding rules read. */
export interface GoalFundingAccountLike {
  category: string;
  subType?: string | null;
}

/** A 529 — the dedicated education_savings category, or a 529 sub-type a
 *  legacy import filed under another category. `categorizeDraw` treats every
 *  529 draw as a qualified, tax-free education withdrawal, so a 529 must never
 *  pay for anything but an education goal (spec Decision 6). */
export function is529Account(a: GoalFundingAccountLike): boolean {
  return a.category === "education_savings" || a.subType === "529";
}

/** Whether an expense may carry savings accounts: every education goal, and an
 *  Other expense the advisor marked "Show as a goal". Living and insurance rows
 *  never do (spec Decision 2). */
export function canHaveGoalFunding(e: { type: string; isGoal?: boolean }): boolean {
  return e.type === "education" || (e.type === "other" && e.isGoal === true);
}

/** The goal's savings accounts the projection may draw, in draw order. An
 *  education goal draws every linked account, as it always has. Any other goal
 *  skips 529s (`is529Account`) and accounts the plan no longer holds — the save
 *  rules refuse both, and this is the backstop for a link that slipped past. */
export function goalDrawAccountIds(
  goal: { type: string; dedicatedAccountIds?: string[] },
  accountById: ReadonlyMap<string, GoalFundingAccountLike>,
): string[] {
  const ids = goal.dedicatedAccountIds ?? [];
  if (goal.type === "education") return ids;
  return ids.filter((id) => {
    const a = accountById.get(id);
    return a != null && !is529Account(a);
  });
}

/** Whether the projection funds this expense in its goal step rather than as a
 *  plain expense. Every education goal does, as before. An Other goal does only
 *  once it has an account to draw — without one it stays a plain expense, so
 *  marking an expense as a goal never moves a number by itself. */
export function isFundedGoal(
  goal: { type: string; isGoal?: boolean; dedicatedAccountIds?: string[] },
  accountById: ReadonlyMap<string, GoalFundingAccountLike>,
): boolean {
  if (goal.type === "education") return true;
  return canHaveGoalFunding(goal) && goalDrawAccountIds(goal, accountById).length > 0;
}

export interface GoalDrawTax {
  ordinaryIncome: number;
  capitalGains: number;
  basisReturn: number;
  earlyWithdrawalPenalty: number;
}

export interface GoalDrawInput {
  /** Indexed goal cost for the year (>= 0). */
  goalCost: number;
  /** Dedicated funding account ids, in draw order. */
  dedicatedAccountIds: string[];
  /** Current available balance per account id. */
  balances: Record<string, number>;
  /** Tax categorizer for a draw of `amount` from `accountId` (e.g. wraps categorizeDraw). */
  categorize: (accountId: string, amount: number) => GoalDrawTax;
}

export interface GoalDraw extends GoalDrawTax {
  accountId: string;
  amount: number;
}

export interface GoalDrawResult {
  draws: GoalDraw[];
  dedicatedWithdrawal: number;
  shortfall: number;
  ordinaryIncome: number;
  capitalGains: number;
  earlyWithdrawalPenalty: number;
}

export function computeGoalDraw(input: GoalDrawInput): GoalDrawResult {
  const { goalCost, dedicatedAccountIds, balances, categorize } = input;
  let remaining = Math.max(0, goalCost);
  const draws: GoalDraw[] = [];
  let ordinaryIncome = 0;
  let capitalGains = 0;
  let earlyWithdrawalPenalty = 0;

  for (const id of dedicatedAccountIds) {
    if (remaining <= 0) break;
    const available = Math.max(0, balances[id] ?? 0);
    if (available <= 0) continue;
    const amount = Math.min(remaining, available);
    const tax = categorize(id, amount);
    draws.push({ accountId: id, amount, ...tax });
    ordinaryIncome += tax.ordinaryIncome;
    capitalGains += tax.capitalGains;
    earlyWithdrawalPenalty += tax.earlyWithdrawalPenalty;
    remaining -= amount;
  }

  const dedicatedWithdrawal = Math.max(0, goalCost) - remaining;
  return {
    draws,
    dedicatedWithdrawal,
    shortfall: remaining,
    ordinaryIncome,
    capitalGains,
    earlyWithdrawalPenalty,
  };
}
