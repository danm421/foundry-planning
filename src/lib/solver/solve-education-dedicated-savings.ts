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
}

export interface EducationSolveResult {
  additionalAnnual: number;
  fundsFully: boolean;
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

function goalShortfall(years: ProjectionYear[], goalId: string): number {
  return years
    .flatMap((y) => y.educationGoals ?? [])
    .filter((g) => g.goalId === goalId)
    .reduce((s, g) => s + g.shortfall, 0);
}

export function solveEducationDedicatedSavings(input: EducationSolveInput): EducationSolveResult {
  const { tree, goalId, accountId, currentYear, runProjection } = input;
  const maxIterations = input.maxIterations ?? 24;
  const tolerance = input.tolerance ?? 1;
  const cap = input.cap ?? 1_000_000;

  const goal = tree.expenses.find((e) => e.id === goalId && e.type === "education");
  const lastDrawYear = goal?.endYear ?? currentYear;

  const shortfallAt = (additional: number): number =>
    goalShortfall(
      runProjection(withAdditionalContribution(tree, accountId, additional, currentYear, lastDrawYear)),
      goalId,
    );

  // Already funded.
  if (shortfallAt(0) <= tolerance) return { additionalAnnual: 0, fundsFully: true };

  // Grow an upper bracket until the gap closes or we hit the cap.
  let hi = Math.max(1_000, goal?.annualAmount ?? 1_000);
  while (hi < cap && shortfallAt(hi) > tolerance) hi *= 2;
  if (hi >= cap && shortfallAt(cap) > tolerance) {
    return { additionalAnnual: cap, fundsFully: false };
  }
  hi = Math.min(hi, cap);

  // Bisect [0, hi] for the smallest additional with shortfall <= tolerance.
  let lo = 0;
  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hi) / 2;
    if (shortfallAt(mid) <= tolerance) hi = mid;
    else lo = mid;
  }
  return { additionalAnnual: Math.ceil(hi), fundsFully: true };
}
