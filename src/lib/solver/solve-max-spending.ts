//
// Maximum-sustainable-spending solver. Finds the largest uniform scale on the
// plan's retirement living expenses that keeps Monte-Carlo probability-of-success
// at/above a target. Mirrors solve-target.ts: 250-trial bisection search then a
// 1000-trial canonical confirmation, same seed each iteration so MC variance
// never perturbs monotonicity. The MC evaluator is injectable for testing.
import {
  createReturnEngine,
  runMonteCarlo,
  runProjection,
} from "@/engine";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import { applyMutations } from "./apply-mutations";
import { bisect, WIDE_LEVER_MAX_ITERATIONS } from "./bisect";
import { roundToNearest2k, retirementLivingExpenseTotal } from "./max-spending-math";

/** Wide bracket for the spend scale: 0 (no retirement living spend) → 3× plan. */
export const MAX_SPEND_SCALE_HI = 3.0;
const SCALE_STEP = 0.01;

export interface MaxSpendResult {
  /** Max sustainable annual retirement spend, today's dollars, rounded to $2k. */
  realAnnualSpend: number;
  /** Solved scale factor on the plan's retirement living expenses. */
  scaleFactor: number;
  /** Probability of success at the solved scale (canonical 1000-trial run). */
  achievedPoS: number;
  status: "converged" | "unreachable" | "max-iterations";
}

export interface SolveMaxSpendingArgs {
  tree: ClientData;
  mcPayload: MonteCarloPayload;
  /** Target probability of success in (0,1). Default 0.85. */
  targetPoS?: number;
  searchTrials?: number;
  canonicalTrials?: number;
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
  const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.mix]));
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
  const canonicalTrials = args.canonicalTrials ?? 1000;
  const evaluateScale =
    args.evaluateScale ?? makeMcScaleEvaluator(args.tree, args.mcPayload, args.signal);

  const baseSpend = retirementLivingExpenseTotal(args.tree);

  const bisectResult = await bisect({
    lo: 0,
    hi: MAX_SPEND_SCALE_HI,
    step: SCALE_STEP,
    direction: -1, // higher spend → lower PoS
    target: targetPoS,
    // tolerance=0: don't exit early on noisy PoS match — collapse the bracket
    // all the way to one step so we always return the HIGHEST scale that beats
    // the target, not whatever midpoint happened to land within ±2% first.
    tolerance: 0,
    maxIterations: WIDE_LEVER_MAX_ITERATIONS,
    evaluate: (scale) => evaluateScale(scale, searchTrials),
  });

  const canonicalPoS = await evaluateScale(bisectResult.solvedValue, canonicalTrials);

  return {
    scaleFactor: bisectResult.solvedValue,
    realAnnualSpend: roundToNearest2k(bisectResult.solvedValue * baseSpend),
    achievedPoS: canonicalPoS,
    status: bisectResult.status,
  };
}
