import type { ClientData, ProjectionYear, SavingsRule } from "@/engine/types";
import { canHaveGoalFunding, is529Account } from "@/lib/goals";
import { buildSavingsRuleForAccount } from "./quick-add-account";

export interface GoalSolveInput {
  tree: ClientData;
  goalId: string;
  accountId: string;
  currentYear: number;
  runProjection: (tree: ClientData) => ProjectionYear[];
  maxIterations?: number;
  tolerance?: number;
  cap?: number;
  /** Share of the goal's cost to fund, 0–1. Defaults to 1 (fund it fully).
   *  An advisor funding, say, 70% of a private-school bill solves to 0.7, and
   *  the savings leave the remaining 30% uncovered: cash flow pays it when
   *  "Pay shortfall out of pocket" is on, and it is a shortfall otherwise. */
  targetPct?: number;
}

export interface GoalSolveResult {
  additionalAnnual: number;
  /** The solve got the goal to (at least) `targetPct` funded. False only when
   *  the cap was hit first — this source can't reach the target alone. */
  reachesTarget: boolean;
  /** The clamped target actually solved for, so callers label the result with
   *  the same number the search used. */
  targetPct: number;
}

/** The goal a contribution rule serves: its last year bounds the rule. */
export interface GoalRef {
  endYear: number;
}

/** Whether the engine reads this rule's `annualAmount` as its contribution.
 *  It doesn't for a percent-of-salary rule (`resolveContributionAmount`), an
 *  IRS-max rule, or a year-by-year schedule (both resolved first in the
 *  projection); a "minimum additional savings" rule belongs to that solve. */
function isPlainFixedAmountRule(r: SavingsRule): boolean {
  return (
    !(r.annualPercent != null && r.annualPercent > 0) &&
    !r.contributeMax &&
    Object.keys(r.scheduleOverrides ?? {}).length === 0 &&
    !r.fundFromExpenseReduction
  );
}

/**
 * The goal's existing contribution rule on one account, or undefined when it
 * has none yet — the ONE answer the solve, its Apply and the Goals-tab stepper
 * all use (via `goalContributionRule` when they write).
 *
 * The goal's own rule is a plain fixed-amount rule on the account that is
 * contributing now and stops by the goal's last year: the shape both goal forms
 * and `goalContributionRule` write (now → goal end), which is how a written
 * rule is found again — never by its id. Anything else on a household account
 * is the household's — running past the goal, already ended, starting later,
 * or not a dollar amount — and raising it would save for years the goal never
 * sees, or do nothing.
 *
 * A 529's fixed-amount rule that is contributing now is the goal's whatever its
 * end year: a 529 pays only for education (spec Decision 6), so raising its
 * rule never saves anywhere the goal can't use.
 */
export function findGoalContributionRule(
  tree: Pick<ClientData, "accounts" | "savingsRules">,
  goal: GoalRef,
  accountId: string,
  currentYear: number,
): SavingsRule | undefined {
  const acct = tree.accounts.find((a) => a.id === accountId);
  const anyEnd = acct != null && is529Account(acct);
  return tree.savingsRules.find(
    (r) =>
      r.accountId === accountId &&
      isPlainFixedAmountRule(r) &&
      r.startYear <= currentYear &&
      currentYear <= r.endYear &&
      (anyEnd || r.endYear <= goal.endYear),
  );
}

/**
 * The rule a write raises: the goal's own (`findGoalContributionRule`), or else
 * a new one with `annualAmount` 0, spanning now → the goal's end and taxed like
 * any new rule on that account (`buildSavingsRuleForAccount`). The household
 * rule is never touched.
 *
 * `newRuleId` names the new rule. Callers mint it with `crypto.randomUUID()` at
 * write time: a scenario stores it in `scenario_changes.target_id`, a uuid
 * column, and a fresh id per render must never reach a key or a mutation.
 */
export function goalContributionRule(
  tree: Pick<ClientData, "accounts" | "savingsRules">,
  goal: GoalRef,
  accountId: string,
  currentYear: number,
  newRuleId: string,
): SavingsRule {
  const own = findGoalContributionRule(tree, goal, accountId, currentYear);
  if (own) return own;
  const acct = tree.accounts.find((a) => a.id === accountId);
  return buildSavingsRuleForAccount({
    account: { id: accountId, category: acct?.category ?? "", subType: acct?.subType ?? "" },
    annualAmount: 0,
    startYear: currentYear,
    endYear: goal.endYear,
    ruleId: newRuleId,
  });
}

/** Build the candidate tree the SAME way the UI applies the result: raise the
 *  goal's contribution rule on the account (`goalContributionRule`) by
 *  `additional`. The Goals tab's Apply raises that same rule. */
function withAdditionalContribution(
  tree: ClientData,
  goal: GoalRef,
  accountId: string,
  additional: number,
  currentYear: number,
): ClientData {
  const next = structuredClone(tree);
  const current = goalContributionRule(next, goal, accountId, currentYear, crypto.randomUUID());
  const raised = { ...current, annualAmount: current.annualAmount + additional };
  const at = next.savingsRules.findIndex((r) => r.id === raised.id);
  if (at >= 0) next.savingsRules[at] = raised;
  else next.savingsRules.push(raised);
  return next;
}

/** The cost the goal's savings leave uncovered, and the goal's total indexed
 *  cost. Uncovered = goalExpense − dedicatedWithdrawal: what cash flow paid
 *  (`outOfPocketWithdrawal`) still counts, because this solve sizes the
 *  SAVINGS and cash flow is only the backstop (spec 2026-10-05, Decision 7).
 *  Cost comes from the engine's own `goalExpense` rather than a re-derivation
 *  of the tree's indexing — the two must not be allowed to drift. */
function goalTotals(years: ProjectionYear[], goalId: string): { uncovered: number; cost: number } {
  const rows = years.flatMap((y) => y.goals ?? []).filter((g) => g.goalId === goalId);
  return {
    uncovered: rows.reduce((s, g) => s + Math.max(0, g.goalExpense - g.dedicatedWithdrawal), 0),
    cost: rows.reduce((s, g) => s + g.goalExpense, 0),
  };
}

export function solveGoalDedicatedSavings(input: GoalSolveInput): GoalSolveResult {
  const { tree, goalId, accountId, currentYear, runProjection } = input;
  const maxIterations = input.maxIterations ?? 24;
  const tolerance = input.tolerance ?? 1;
  const cap = input.cap ?? 1_000_000;
  const targetPct = Math.min(1, Math.max(0, input.targetPct ?? 1));

  const goal = tree.expenses.find((e) => e.id === goalId && canHaveGoalFunding(e));
  const goalRef: GoalRef = { endYear: goal?.endYear ?? currentYear };

  const totalsAt = (additional: number) =>
    goalTotals(
      runProjection(withAdditionalContribution(tree, goalRef, accountId, additional, currentYear)),
      goalId,
    );

  // A partial target leaves this many dollars uncovered by savings. The goal's
  // cost is fixed by the plan, not by what we contribute, so one read at 0 is
  // enough to set the bar for every later iteration.
  const base = totalsAt(0);
  const allowedUncovered = (1 - targetPct) * base.cost;
  const atTarget = (additional: number): boolean =>
    totalsAt(additional).uncovered <= allowedUncovered + tolerance;

  // Already at (or past) the target.
  if (base.uncovered <= allowedUncovered + tolerance) {
    return { additionalAnnual: 0, reachesTarget: true, targetPct };
  }

  // Grow an upper bracket until the gap closes or we hit the cap.
  let hi = Math.max(1_000, goal?.annualAmount ?? 1_000);
  while (hi < cap && !atTarget(hi)) hi *= 2;
  if (hi >= cap && !atTarget(cap)) {
    return { additionalAnnual: cap, reachesTarget: false, targetPct };
  }
  hi = Math.min(hi, cap);

  // Bisect [0, hi] for the smallest additional that reaches the target.
  let lo = 0;
  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hi) / 2;
    if (atTarget(mid)) hi = mid;
    else lo = mid;
  }
  return { additionalAnnual: Math.ceil(hi), reachesTarget: true, targetPct };
}
