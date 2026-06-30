//
// Maximum-sustainable-spending solver. Finds the uniform scale on the plan's
// retirement living expenses whose Monte-Carlo probability-of-success lands
// closest to a target (even slightly below it), then reports it as today's
// dollars rounded to the nearest $5,000. Mirrors solve-target.ts: a 250-trial
// bisection search then a 250-trial confirmation at the solved scale, same seed
// each iteration so MC variance never perturbs monotonicity. The MC evaluator is
// injectable for testing.
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

/** Wide bracket for the spend scale: 0 (no retirement living spend) → 3× plan. */
export const MAX_SPEND_SCALE_HI = 3.0;
const SCALE_STEP = 0.01;

export interface MaxSpendResult {
  /** Max sustainable annual retirement spend, today's dollars, rounded to $5k. */
  realAnnualSpend: number;
  /** Solved scale factor on the plan's retirement living expenses. */
  scaleFactor: number;
  /** Probability of success at the solved scale (250-trial confirmation run). */
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
  const canonicalTrials = args.canonicalTrials ?? 250;
  const evaluateScale =
    args.evaluateScale ?? makeMcScaleEvaluator(args.tree, args.mcPayload, args.signal);

  const baseSpend = retirementLivingExpenseTotal(args.tree);

  const bisectResult = await bisect({
    lo: 0,
    hi: MAX_SPEND_SCALE_HI,
    step: SCALE_STEP,
    direction: -1, // higher spend → lower PoS
    target: targetPoS,
    // tolerance=0 + selection:"closest": collapse the bracket all the way to one
    // step, then return the scale whose PoS is NEAREST the target — even when it
    // sits slightly below it — instead of rounding down to the last scale that
    // still beats target.
    tolerance: 0,
    selection: "closest",
    maxIterations: WIDE_LEVER_MAX_ITERATIONS,
    evaluate: (scale) => evaluateScale(scale, searchTrials),
  });

  const canonicalPoS = await evaluateScale(bisectResult.solvedValue, canonicalTrials);

  return {
    scaleFactor: bisectResult.solvedValue,
    realAnnualSpend: roundToNearest5k(bisectResult.solvedValue * baseSpend),
    achievedPoS: canonicalPoS,
    status: bisectResult.status,
  };
}
