// src/lib/solver/solve-target.ts
//
// Server-side goal-seek orchestrator. Loads the source tree + MC payload,
// applies the workspace's baseline mutations, then runs a two-phase solve:
//
// Phase 1 — localization (250 trials by default):
//   Runs bisect over the lever search range. For each candidate value:
//   1. Builds a fresh return engine with the SAME seed (so MC variance
//      doesn't perturb monotonicity)
//   2. Applies baseline + candidate mutations to a clone of the tree
//   3. Runs runProjection + runMonteCarlo(trials=250)
//   4. Reports the iteration via the onProgress callback
//
// Phase 2 — re-selection (500 trials, living-expense-scale lever only):
//   After phase 1 localizes the answer to within a couple of $5k steps,
//   refineOnGrid re-evaluates the neighborhood at 500 trials. Because each
//   MC run is the first-N prefix of a seeded sequence, the 250-trial search
//   can sit on a non-representative prefix and systematically under/over-shoot.
//   Re-selecting at 500 trials corrects that without paying for a 1000-trial
//   finalize. The ~±1-step residual vs a 1000-trial report is an accepted
//   tradeoff — see specs/2026-06-30-solver-maxspend-accuracy-design.md.
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
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import { applyMutations } from "./apply-mutations";
import { bisect, WIDE_LEVER_MAX_ITERATIONS } from "./bisect";
import { refineOnGrid } from "./refine-on-grid";
import { memoizeByValue } from "./eval-cache";
import { buildLeverMutation, leverSearchConfig } from "./lever-search-config";
import { roundToNearest5k } from "./living-expense";
import { resolveTechniqueMutations } from "./resolve-technique-mutations";
import type { SolveLeverKey, SolveProgressEvent, SolveResultEvent } from "./solve-types";
import type { SolverMutation } from "./types";
import {
  bracketFromSeed,
  deterministicLocalize,
  straightlineSucceeds,
  type WarmStartOutcome,
} from "./warm-start";

export interface SolveTargetArgs {
  effectiveTree: ClientData;
  mcPayload: MonteCarloPayload;
  baselineMutations: SolverMutation[];
  target: SolveLeverKey;
  targetPoS: number;
  /** Default 250 (per spec). */
  trials?: number;
  /** Trial count for the phase-2 re-selection walk (living-expense lever). Default 500. */
  refineTrials?: number;
  /** Injectable evaluator (value, trials) → {pos, projection}. Defaults to the real
   *  MC compute. Used by tests and to keep the refine wiring unit-testable. */
  evaluate?: (value: number, trials: number) => Promise<{ pos: number; projection: ProjectionYear[] }>;
  /** Straightline success for a candidate lever value. Defaults to the real
   *  deterministic projection ONLY when `evaluate` is not injected (tests
   *  inject both or opt out of the warm start entirely). */
  evaluateStraightline?: (value: number) => Promise<boolean>;
  /** Called once per candidate evaluation. */
  onProgress?: (event: SolveProgressEvent) => void;
  /** Cancellation signal forwarded to runMonteCarlo. */
  signal?: AbortSignal;
  /** Resolution context for re-resolving reinvestments in baseline mutations. */
  resolutionContext?: ResolutionContext;
}

export async function solveTarget(args: SolveTargetArgs): Promise<SolveResultEvent> {
  const trials = args.trials ?? 250;
  const refineTrials = args.refineTrials ?? 500;
  const searchTree = applyMutations(args.effectiveTree, args.baselineMutations);
  const config = leverSearchConfig(args.target, searchTree);
  const accountMixes = new Map(args.mcPayload.accountMixes.map((a) => [a.accountId, a.segments]));

  interface EvalEntry {
    pos: number;
    projection: ProjectionYear[];
  }

  // Real MC compute: (value, trials) → {pos, projection}. Injectable for tests.
  const realCompute = async (value: number, t: number): Promise<EvalEntry> => {
    const allMutations = [
      ...args.baselineMutations,
      // Resolve the lever mutation against searchTree (baseline applied), not the
      // pre-baseline effectiveTree: a roth-conversion-amount lever whose conversion
      // was created inline in the workspace exists only as a baseline mutation, and
      // buildLeverMutation throws if it can't find it. Mirrors leverSearchConfig's
      // lookup (line above) and the client's workingTree key derivation (F4).
      buildLeverMutation(args.target, value, searchTree),
    ];
    let tree = applyMutations(args.effectiveTree, allMutations);
    if (args.resolutionContext) {
      tree = resolveTechniqueMutations(tree, allMutations, args.resolutionContext);
    }
    const projection = runProjection(tree);
    // Same seed every iteration so only the lever changes, not MC variance.
    const engine = createReturnEngine({
      indices: args.mcPayload.indices,
      correlation: args.mcPayload.correlation,
      seed: args.mcPayload.seed,
    });
    const mc = await runMonteCarlo({
      data: tree,
      returnEngine: engine,
      accountMixes,
      trials: t,
      requiredMinimumAssetLevel: args.mcPayload.requiredMinimumAssetLevel,
      signal: args.signal,
      yieldEvery: 50,
    });
    return { pos: mc.successRate, projection };
  };

  const computeFn = args.evaluate ?? realCompute;
  // Separate memo per trial count: a 250-trial eval must never satisfy a 500-trial
  // lookup at the same value (memoizeByValue keys by value only).
  const searchMemo = memoizeByValue<EvalEntry>((v) => computeFn(v, trials));
  const refineMemo = memoizeByValue<EvalEntry>((v) => computeFn(v, refineTrials));

  // Both phases share one evaluate protocol (abort check, iteration counter,
  // progress event); only the memo differs. A single factory keeps the search
  // and refine evaluators structurally identical so they can never drift.
  let iteration = 0;
  const makeEvaluate =
    (memo: typeof searchMemo, phase: "search" | "refine") =>
    async (value: number): Promise<number> => {
      if (args.signal?.aborted) throw new Error("aborted");
      iteration += 1;
      const entry = await memo(value);
      args.onProgress?.({ iteration, candidateValue: value, achievedPoS: entry.pos, phase });
      return entry.pos;
    };

  // Phase 0 — deterministic warm start. Straightline projections localize the
  // answer, then ≤4 secant MC probes bracket the target PoS. Uninformative
  // seed (e.g. roth) or exhausted budget → the full-range path below, which is
  // the entire pre-warm-start behavior.
  const evaluateStraightline =
    args.evaluateStraightline ??
    (args.evaluate
      ? null
      : async (value: number): Promise<boolean> => {
          const allMutations = [
            ...args.baselineMutations,
            buildLeverMutation(args.target, value, searchTree),
          ];
          let tree = applyMutations(args.effectiveTree, allMutations);
          if (args.resolutionContext) {
            tree = resolveTechniqueMutations(tree, allMutations, args.resolutionContext);
          }
          return straightlineSucceeds(
            runProjection(tree),
            args.mcPayload.requiredMinimumAssetLevel ?? 0,
          );
        });

  let warm: WarmStartOutcome = { kind: "fallback" };
  if (evaluateStraightline) {
    const seed = await deterministicLocalize({
      lo: config.lo,
      hi: config.hi,
      step: config.step,
      succeeds: evaluateStraightline,
    });
    if (seed !== null) {
      warm = await bracketFromSeed({
        seed,
        lo: config.lo,
        hi: config.hi,
        step: config.step,
        direction: config.direction,
        target: args.targetPoS,
        evaluate: makeEvaluate(searchMemo, "search"),
      });
    }
  }

  // Phase 1 — localize at `trials` (250): warm bracket when available
  // (endpoint PoS pre-known via the shared memo), else the full range.
  const bisectResult =
    warm.kind === "result"
      ? {
          status: warm.status,
          solvedValue: warm.solvedValue,
          achievedPoS: warm.achievedPoS,
          iterations: iteration,
        }
      : await bisect({
          lo: warm.kind === "bracket" ? warm.lo : config.lo,
          hi: warm.kind === "bracket" ? warm.hi : config.hi,
          posLo: warm.kind === "bracket" ? warm.posLo : undefined,
          posHi: warm.kind === "bracket" ? warm.posHi : undefined,
          step: config.step,
          direction: config.direction,
          target: args.targetPoS,
          tolerance: config.tolerance,
          selection: config.selection,
          maxIterations: WIDE_LEVER_MAX_ITERATIONS,
          evaluate: makeEvaluate(searchMemo, "search"),
        });

  let solvedValue = bisectResult.solvedValue;

  if (args.target.kind === "living-expense-scale") {
    // Max-spend solve: snap to $5k, then re-select at refineTrials (500).
    solvedValue = roundToNearest5k(solvedValue);
    if (bisectResult.status !== "unreachable") {
      const refined = await refineOnGrid({
        start: solvedValue,
        step: 5000,
        direction: config.direction, // -1
        target: args.targetPoS,
        min: 0,
        max: config.hi,
        evaluate: makeEvaluate(refineMemo, "refine"),
      });
      solvedValue = refined.solvedValue;
    }
  }

  // Final PoS + projection at the solved value, read once. The living-expense
  // lever reports at refineTrials (500) — a cache hit when the walk already
  // visited solvedValue; every other lever reports at searchTrials (250).
  const finalMemo =
    args.target.kind === "living-expense-scale" ? refineMemo : searchMemo;
  const entry = await finalMemo(solvedValue);
  const achievedPoS = entry.pos;
  const finalProjection = entry.projection;

  return {
    objective: "pos",
    status: bisectResult.status,
    solvedValue,
    achievedPoS,
    canonicalPoS: achievedPoS,
    iterations: iteration,
    finalProjection,
    seed: args.mcPayload.seed,
  };
}
