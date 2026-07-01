//
// Maximum-sustainable-spending solver. Finds the uniform scale on the plan's
// retirement living expenses whose Monte-Carlo probability-of-success lands
// closest to a target (even slightly below it), then reports it as today's
// dollars rounded to the nearest $5,000. Same seed each iteration so MC variance
// never perturbs monotonicity. The MC evaluator is injectable for testing.
// A 250-trial bisection localizes the crossing, then refineOnGrid re-selects on
// the $5k grid at 500 trials. Finalizing at 500 (not the report's 1000) is a
// deliberate speed/accuracy tradeoff — see specs/2026-06-30-solver-maxspend-accuracy-design.md.
import {
  createReturnEngine,
  runMonteCarlo,
  runProjection,
} from "@/engine";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import { applyMutations } from "./apply-mutations";
import { bisect, WIDE_LEVER_MAX_ITERATIONS } from "./bisect";
import { roundToNearest5k, retirementLivingExpenseTotal } from "./max-spending-math";
import { refineOnGrid } from "./refine-on-grid";

/** Wide bracket for the spend scale: 0 (no retirement living spend) → 3× plan. */
export const MAX_SPEND_SCALE_HI = 3.0;
const SCALE_STEP = 0.01;

export interface MaxSpendResult {
  /** Max sustainable annual retirement spend, today's dollars, rounded to $5k. */
  realAnnualSpend: number;
  /** Solved scale factor on the plan's retirement living expenses. */
  scaleFactor: number;
  /** Probability of success at the solved scale (refine-trial (500) PoS). */
  achievedPoS: number;
  status: "converged" | "unreachable" | "max-iterations";
}

export interface SolveMaxSpendingArgs {
  tree: ClientData;
  mcPayload: MonteCarloPayload;
  /** Target probability of success in (0,1). Default 0.85. */
  targetPoS?: number;
  searchTrials?: number;
  /** Trial count for the phase-2 re-selection walk. Default 500. */
  refineTrials?: number;
  signal?: AbortSignal;
  /** PoS for a candidate scale. Defaults to the real MC evaluator. Injectable for tests. */
  evaluateScale?: (scale: number, trials: number) => Promise<number>;
}

/** Build the real Monte-Carlo evaluator: scale → PoS, fixed seed each call. */
export function makeMcScaleEvaluator(
  tree: ClientData,
  mcPayload: MonteCarloPayload,
  signal?: AbortSignal,
): (scale: number, trials: number) => Promise<number> {
  const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.segments]));
  return async (scale, trials) => {
    const mutated = applyMutations(tree, [{ kind: "living-expense-scale", multiplier: scale }]);
    runProjection(mutated);
    const engine = createReturnEngine({
      indices: mcPayload.indices,
      correlation: mcPayload.correlation,
      seed: mcPayload.seed,
    });
    const mc = await runMonteCarlo({
      data: mutated,
      returnEngine: engine,
      accountMixes,
      trials,
      requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
      signal,
      yieldEvery: 50,
    });
    return mc.successRate;
  };
}

export async function solveMaxSpending(args: SolveMaxSpendingArgs): Promise<MaxSpendResult> {
  const targetPoS = args.targetPoS ?? 0.85;
  const searchTrials = args.searchTrials ?? 250;
  const refineTrials = args.refineTrials ?? 500;
  const evaluateScale =
    args.evaluateScale ?? makeMcScaleEvaluator(args.tree, args.mcPayload, args.signal);

  const baseSpend = retirementLivingExpenseTotal(args.tree);

  // Phase 1 — localize the crossing cheaply at 250 trials (scale space).
  const bisectResult = await bisect({
    lo: 0,
    hi: MAX_SPEND_SCALE_HI,
    step: SCALE_STEP,
    direction: -1, // higher spend → lower PoS
    target: targetPoS,
    tolerance: 0,
    selection: "closest",
    maxIterations: WIDE_LEVER_MAX_ITERATIONS,
    evaluate: (scale) => evaluateScale(scale, searchTrials),
  });

  const startDollars = roundToNearest5k(bisectResult.solvedValue * baseSpend);

  // Phase 2 — re-select on the $5k dollar grid at 500 trials. Skip when the plan
  // is unreachable (even $0 spend misses the target) — keep the conservative
  // phase-1 answer rather than walking.
  let solvedDollars = startDollars;
  let achievedPoS = bisectResult.achievedPoS;
  if (bisectResult.status !== "unreachable" && baseSpend > 0) {
    const refined = await refineOnGrid({
      start: startDollars,
      step: 5000,
      direction: -1,
      target: targetPoS,
      min: 0,
      max: roundToNearest5k(MAX_SPEND_SCALE_HI * baseSpend),
      evaluate: (dollars) => evaluateScale(dollars / baseSpend, refineTrials),
    });
    solvedDollars = refined.solvedValue;
    achievedPoS = refined.achievedPoS;
  } else {
    // Unreachable / zero-base: report the conservative answer's PoS at refineTrials.
    achievedPoS = await evaluateScale(bisectResult.solvedValue, refineTrials);
  }

  return {
    scaleFactor: baseSpend > 0 ? solvedDollars / baseSpend : 0,
    realAnnualSpend: solvedDollars,
    achievedPoS,
    status: bisectResult.status,
  };
}
