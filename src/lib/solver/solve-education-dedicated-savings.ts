import type { ClientData, ProjectionYear, SavingsRule } from "@/engine/types";

export interface EducationSolveInput {
  tree: ClientData;
  goalId: string;
  accountId: string;
  currentYear: number;
  runProjection: (tree: ClientData) => ProjectionYear[];
  maxIterations?: number;
  tolerance?: number;
  cap?: number;
  /** Share of the goal's cost to fund, 0–1. Defaults to 1 (fund it fully).
   *  An advisor funding, say, 70% of a private-school bill solves to 0.7 and
   *  the remaining 30% is left as a deliberate shortfall. */
  targetPct?: number;
}

export interface EducationSolveResult {
  additionalAnnual: number;
  /** The solve got the goal to (at least) `targetPct` funded. False only when
   *  the cap was hit first — this source can't reach the target alone. */
  reachesTarget: boolean;
  /** The clamped target actually solved for, so callers label the result with
   *  the same number the search used. */
  targetPct: number;
}

/** Build the candidate tree the SAME way the UI applies the result: bump the
 *  first savings rule on the account, or create a new rule spanning now → the
 *  goal's last draw year. Exported so the apply path stays consistent. */
export function withAdditionalContribution(
  tree: ClientData,
  accountId: string,
  additional: number,
  currentYear: number,
  lastDrawYear: number,
): ClientData {
  const next = structuredClone(tree);
  const existing = next.savingsRules.find((r) => r.accountId === accountId);
  if (existing) {
    next.savingsRules = next.savingsRules.map((r) =>
      r.id === existing.id ? { ...r, annualAmount: r.annualAmount + additional } : r,
    );
  } else {
    const rule: SavingsRule = {
      id: `edu-solve-${accountId}`,
      accountId,
      annualAmount: additional,
      isDeductible: false,
      startYear: currentYear,
      endYear: lastDrawYear,
    };
    next.savingsRules.push(rule);
  }
  return next;
}

/** Unfunded dollars and total indexed cost for one goal. Cost comes from the
 *  engine's own `goalExpense` rather than a re-derivation of the tree's
 *  indexing — the two must not be allowed to drift. */
function goalTotals(years: ProjectionYear[], goalId: string): { shortfall: number; cost: number } {
  const rows = years.flatMap((y) => y.educationGoals ?? []).filter((g) => g.goalId === goalId);
  return {
    shortfall: rows.reduce((s, g) => s + g.shortfall, 0),
    cost: rows.reduce((s, g) => s + g.goalExpense, 0),
  };
}

export function solveEducationDedicatedSavings(input: EducationSolveInput): EducationSolveResult {
  const { tree, goalId, accountId, currentYear, runProjection } = input;
  const maxIterations = input.maxIterations ?? 24;
  const tolerance = input.tolerance ?? 1;
  const cap = input.cap ?? 1_000_000;
  const targetPct = Math.min(1, Math.max(0, input.targetPct ?? 1));

  const goal = tree.expenses.find((e) => e.id === goalId && e.type === "education");
  const lastDrawYear = goal?.endYear ?? currentYear;

  const totalsAt = (additional: number) =>
    goalTotals(
      runProjection(withAdditionalContribution(tree, accountId, additional, currentYear, lastDrawYear)),
      goalId,
    );

  // A partial target leaves this many dollars deliberately unfunded. The goal's
  // cost is fixed by the plan, not by what we contribute, so one read at 0 is
  // enough to set the bar for every later iteration.
  const base = totalsAt(0);
  const allowedShortfall = (1 - targetPct) * base.cost;
  const atTarget = (additional: number): boolean =>
    totalsAt(additional).shortfall <= allowedShortfall + tolerance;

  // Already at (or past) the target.
  if (base.shortfall <= allowedShortfall + tolerance) {
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
