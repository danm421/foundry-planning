// src/lib/solver/solve-target.ts
//
// Server-side goal-seek orchestrator. Loads the source tree + MC payload,
// applies the workspace's baseline mutations, then runs bisect with an
// evaluator that for each candidate lever value:
//   1. Builds a fresh return engine with the SAME seed (so MC variance
//      doesn't perturb monotonicity)
//   2. Applies baseline + candidate mutations to a clone of the tree
//   3. Runs runProjection + runMonteCarlo(trials=250)
//   4. Reports the iteration via the onProgress callback
//
// Pure-ish: takes the loaded tree + MC payload as inputs. The route handler
// owns the DB IO.

import {
  createReturnEngine,
  runMonteCarlo,
  runProjection,
} from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import { applyMutations } from "./apply-mutations";
import { bisect } from "./bisect";
import { buildLeverMutation, leverSearchConfig } from "./lever-search-config";
import type { SolveLeverKey, SolveProgressEvent, SolveResultEvent } from "./solve-types";
import type { SolverMutation } from "./types";

export interface SolveTargetArgs {
  effectiveTree: ClientData;
  mcPayload: MonteCarloPayload;
  baselineMutations: SolverMutation[];
  target: SolveLeverKey;
  targetPoS: number;
  /** Default 250 (per spec). */
  trials?: number;
  /** Called once per candidate evaluation. */
  onProgress?: (event: SolveProgressEvent) => void;
  /** Cancellation signal forwarded to runMonteCarlo. */
  signal?: AbortSignal;
}

export async function solveTarget(args: SolveTargetArgs): Promise<SolveResultEvent> {
  const trials = args.trials ?? 250;
  const config = leverSearchConfig(args.target, args.effectiveTree);
  const accountMixes = new Map(args.mcPayload.accountMixes.map((a) => [a.accountId, a.mix]));

  let iteration = 0;
  let lastEvaluatedValue: number | null = null;
  let lastProjection: ProjectionYear[] | null = null;

  const evaluate = async (value: number): Promise<number> => {
    if (args.signal?.aborted) throw new Error("aborted");
    iteration += 1;
    const tree = applyMutations(args.effectiveTree, [
      ...args.baselineMutations,
      buildLeverMutation(args.target, value),
    ]);
    const projection = runProjection(tree);
    // Re-create return engine each iteration with the same seed so that the
    // RNG state restarts identically every time — only the lever changes.
    const engine = createReturnEngine({
      indices: args.mcPayload.indices,
      correlation: args.mcPayload.correlation,
      seed: args.mcPayload.seed,
    });
    const mc = await runMonteCarlo({
      data: tree,
      returnEngine: engine,
      accountMixes,
      trials,
      requiredMinimumAssetLevel: args.mcPayload.requiredMinimumAssetLevel,
      signal: args.signal,
      yieldEvery: 50,
    });
    lastEvaluatedValue = value;
    lastProjection = projection;
    args.onProgress?.({ iteration, candidateValue: value, achievedPoS: mc.successRate });
    return mc.successRate;
  };

  const bisectResult = await bisect({
    lo: config.lo,
    hi: config.hi,
    step: config.step,
    direction: config.direction,
    target: args.targetPoS,
    evaluate,
  });

  // The bisection may have ended on an endpoint or earlier iteration whose
  // projection isn't the final one we want to return. Re-evaluate at the
  // solved value if needed so finalProjection reflects the chosen value.
  if (lastEvaluatedValue !== bisectResult.solvedValue || lastProjection === null) {
    await evaluate(bisectResult.solvedValue);
  }

  return {
    status: bisectResult.status,
    solvedValue: bisectResult.solvedValue,
    achievedPoS: bisectResult.achievedPoS,
    iterations: bisectResult.iterations,
    finalProjection: lastProjection!,
  };
}
