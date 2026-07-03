//
// Maximum-sustainable-spending solver. Finds the annual retirement living spend
// (today's dollars) whose Monte-Carlo probability-of-success lands closest to a
// target, then reports it rounded to the nearest $5,000. Same seed each iteration
// so MC variance never perturbs monotonicity. The MC evaluator is injectable for
// testing. A 250-trial bisection localizes the crossing, then refineOnGrid
// re-selects on the $5k grid at 500 trials. Finalizing at 500 (not the report's
// 1000) is a deliberate speed/accuracy tradeoff — see
// specs/2026-06-30-solver-maxspend-accuracy-design.md.
//
// The search runs directly in dollar space (a `living-expense-amount` mutation),
// matching the goal-seek's `living-expense-scale` lever: this makes the ceiling
// resource-aware (not a blind 3× the stated expense) and works even when the plan
// states $0 retirement living spend, in which case planLivingExpenseAmount
// synthesizes / even-splits a row rather than multiplying $0 forever.
import {
  createReturnEngine,
  runMonteCarlo,
  runProjection,
} from "@/engine";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import { applyMutations } from "./apply-mutations";
import type { BisectResult } from "./bisect";
import { bisect, WIDE_LEVER_MAX_ITERATIONS } from "./bisect";
import { livingExpenseSearchCeiling } from "./lever-search-config";
import { roundToNearest5k, retirementLivingExpenseTotal } from "./max-spending-math";
import { refineOnGrid } from "./refine-on-grid";
import {
  bracketFromSeed,
  deterministicLocalize,
  straightlineSucceeds,
  type WarmStartOutcome,
} from "./warm-start";

/** Floor multiple on the stated retirement spend used when the resource-aware
 *  ceiling would otherwise clamp below it (e.g. a $1M+/yr stated spend). */
export const MAX_SPEND_SCALE_HI = 3.0;
const GRID_STEP = 5000;

export interface MaxSpendResult {
  /** Max sustainable annual retirement spend, today's dollars, rounded to $5k. */
  realAnnualSpend: number;
  /** Solved spend as a multiple of the plan's stated retirement spend (0 when the
   *  plan states no retirement living expense). */
  scaleFactor: number;
  /** Probability of success at the solved spend (refine-trial (500) PoS). */
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
  /** PoS for a candidate annual spend (today's dollars). Defaults to the real MC
   *  evaluator. Injectable for tests. */
  evaluateSpend?: (dollars: number, trials: number) => Promise<number>;
  /** Straightline success for a candidate annual spend. Defaults to the real
   *  deterministic projection ONLY when evaluateSpend is not injected (tests
   *  inject both or opt out of the warm start entirely). */
  evaluateStraightline?: (dollars: number) => Promise<boolean>;
}

/** Build the real Monte-Carlo evaluator: annual spend (dollars) → PoS, fixed seed
 *  each call. */
export function makeMcSpendEvaluator(
  tree: ClientData,
  mcPayload: MonteCarloPayload,
  signal?: AbortSignal,
): (dollars: number, trials: number) => Promise<number> {
  const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.segments]));
  return async (dollars, trials) => {
    const mutated = applyMutations(tree, [{ kind: "living-expense-amount", amount: dollars }]);
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

/** Build the real straightline evaluator: annual spend (dollars) → does the
 *  deterministic projection succeed under the MC success definition. */
export function makeDeterministicSpendEvaluator(
  tree: ClientData,
  requiredMinimumAssetLevel: number,
): (dollars: number) => Promise<boolean> {
  return async (dollars) => {
    const mutated = applyMutations(tree, [
      { kind: "living-expense-amount", amount: dollars },
    ]);
    return straightlineSucceeds(runProjection(mutated), requiredMinimumAssetLevel);
  };
}

export async function solveMaxSpending(args: SolveMaxSpendingArgs): Promise<MaxSpendResult> {
  const targetPoS = args.targetPoS ?? 0.85;
  const searchTrials = args.searchTrials ?? 250;
  const refineTrials = args.refineTrials ?? 500;
  const evaluateSpend =
    args.evaluateSpend ?? makeMcSpendEvaluator(args.tree, args.mcPayload, args.signal);

  const baseSpend = retirementLivingExpenseTotal(args.tree);
  // Resource-aware ceiling: at least 3× the stated spend, but also the dollar-space
  // lever's resource estimate (income + 10% assets, clamped [300k, 3M]), so a modest
  // stated expense on a large portfolio isn't capped below true capacity. The max()
  // keeps a very-high stated spend (>$1M/yr) from being clamped below itself.
  const ceilingDollars = roundToNearest5k(
    Math.max(MAX_SPEND_SCALE_HI * baseSpend, livingExpenseSearchCeiling(args.tree)),
  );

  const evaluateStraightline =
    args.evaluateStraightline ??
    (args.evaluateSpend
      ? null
      : makeDeterministicSpendEvaluator(args.tree, args.mcPayload.requiredMinimumAssetLevel));

  // Phase 0 — deterministic warm start: localize with straightline projections
  // (~1/250th of one MC probe each), then secant MC probes to bracket the
  // target. Every failure mode degrades to the pre-warm-start full-range path.
  let warm: WarmStartOutcome = { kind: "fallback" };
  if (evaluateStraightline) {
    // Any warm-start exception degrades to the pre-feature full-range path.
    try {
      const seed = await deterministicLocalize({
        lo: 0,
        hi: ceilingDollars,
        step: GRID_STEP,
        succeeds: evaluateStraightline,
      });
      if (seed !== null) {
        warm = await bracketFromSeed({
          seed,
          lo: 0,
          hi: ceilingDollars,
          step: GRID_STEP,
          direction: -1,
          target: targetPoS,
          evaluate: (dollars) => evaluateSpend(dollars, searchTrials),
        });
      }
    } catch {
      warm = { kind: "fallback" };
    }
  }

  // Phase 1 — localize the crossing at 250 trials: on the warm bracket when
  // available (endpoint PoS pre-known), else the full range as before.
  const bisectResult: BisectResult =
    warm.kind === "result"
      ? {
          status: warm.status,
          solvedValue: warm.solvedValue,
          achievedPoS: warm.achievedPoS,
          iterations: 0,
        }
      : await bisect({
          lo: warm.kind === "bracket" ? warm.lo : 0,
          hi: warm.kind === "bracket" ? warm.hi : ceilingDollars,
          posLo: warm.kind === "bracket" ? warm.posLo : undefined,
          posHi: warm.kind === "bracket" ? warm.posHi : undefined,
          step: GRID_STEP,
          direction: -1, // higher spend → lower PoS
          target: targetPoS,
          tolerance: 0,
          selection: "closest",
          maxIterations: WIDE_LEVER_MAX_ITERATIONS,
          evaluate: (dollars) => evaluateSpend(dollars, searchTrials),
        });

  const startDollars = bisectResult.solvedValue; // already on the $5k grid

  // Phase 2 — re-select on the $5k dollar grid at 500 trials. Skip when the plan
  // is unreachable (even $0 spend misses the target) — keep the conservative
  // phase-1 answer rather than walking.
  let solvedDollars = startDollars;
  let achievedPoS = bisectResult.achievedPoS;
  if (bisectResult.status !== "unreachable") {
    const refined = await refineOnGrid({
      start: startDollars,
      step: GRID_STEP,
      direction: -1,
      target: targetPoS,
      min: 0,
      max: ceilingDollars,
      evaluate: (dollars) => evaluateSpend(dollars, refineTrials),
    });
    solvedDollars = refined.solvedValue;
    achievedPoS = refined.achievedPoS;
  } else {
    // Unreachable: report the conservative answer's PoS at refineTrials.
    achievedPoS = await evaluateSpend(bisectResult.solvedValue, refineTrials);
  }

  return {
    scaleFactor: baseSpend > 0 ? solvedDollars / baseSpend : 0,
    realAnnualSpend: solvedDollars,
    achievedPoS,
    status: bisectResult.status,
  };
}
