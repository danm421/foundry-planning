// src/lib/life-insurance/solve-need-mc.ts
//
// Monte Carlo variant of the life-insurance need solver. Where
// `solveLifeInsuranceNeed` (solve-need.ts) bisects on face value against a
// single deterministic ending-portfolio target, this solver bisects on face
// value against a Monte Carlo *probability of success* — "what death benefit
// makes the survivor's plan succeed in `mcTargetScore` of trials".
//
// Each candidate face value is evaluated by:
//   1. Assembling the what-if `ClientData` via `buildLifeInsuranceWhatIfData`
//      (premature death + synthetic policy + survivor horizon extension).
//   2. Running `runMonteCarlo` over it with a FIXED seed every iteration, so
//      MC variance never perturbs the score's monotonicity in face value —
//      the same trick `src/lib/solver/solve-target.ts` uses.
//
// Pure-ish: takes the loaded MC payload as an input. The route handler
// (Task 13) owns the DB IO that produces that payload.

import { createReturnEngine, runMonteCarlo } from "@/engine";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import { buildLifeInsuranceWhatIfData } from "@/engine/what-if/life-insurance-need";
import type { LifeInsuranceAssumptions } from "./solve-need";
import { findRootAsync } from "./root-find";

/** Maximum face value the solver will try before declaring exceeds-cap.
 *  Matches the straight-line solver's cap (solve-need.ts). */
const CAP = 20_000_000;

/** Production Monte Carlo trial count (per the Life Insurance Solver plan). */
const DEFAULT_TRIALS = 250;

/** Coarse Monte Carlo trials used during the search phase, before the full-trial
 *  refine. Low enough to make search probes cheap, high enough to land near the
 *  root; the refine phase resolves the final SCORE_TOLERANCE band. */
const DEFAULT_COARSE_TRIALS = 64;

/** Bisection stops when the achieved MC score is within ±0.02 of the target. */
const SCORE_TOLERANCE = 0.02;

/** Maximum bisection iterations — 24 halvings of [0, 20M] resolves to <$2. */
const MAX_ITERATIONS = 24;

/** Expected total evaluations used to size the progress bar. Two-phase solve =
 *  a coarse bracket pass (~6-8) + a full-trial refine (~3-5). `done` is clamped
 *  to this value so a rare long run never overflows the bar. */
const EXPECTED_EVALUATIONS = 16;

export interface NeedMcResult {
  status: "solved" | "exceeds-cap";
  faceValue: number;
  achievedScore: number;
  iterations: number;
}

export interface SolveLifeInsuranceNeedMcOptions {
  /** Monte Carlo trials per candidate evaluation. Defaults to 250. Tests
   *  pass a low count (100–200) to stay within their time budget. */
  trials?: number;
  /** Coarse trials for the search phase (Phase A). Defaults to 64. When
   *  `coarseTrials >= trials` the coarse phase is skipped and the solver runs a
   *  single full-trial pass (parity path). */
  coarseTrials?: number;
  /** Called once per candidate evaluation with the running evaluation count
   *  and a fixed estimated total (`EXPECTED_EVALUATIONS`). `done` is clamped
   *  so it never exceeds `total`, even on a rare long run. */
  onProgress?: (done: number, total: number) => void;
  /** Cancellation signal. Checked between bisection iterations and forwarded
   *  to `runMonteCarlo` so an in-flight trial loop can also bail. */
  signal?: AbortSignal;
}

/**
 * Pure bracket orchestration for the MC need solver. Given an injected
 * `evaluate(faceValue) => Promise<score>` (monotonic non-decreasing in face
 * value) plus the target/cap/tolerance/iteration budget, returns either the
 * solved face value or `exceeds-cap`. Extracted from `solveLifeInsuranceNeedMc`
 * so the bracket guards are unit-testable with a deterministic `evaluate`.
 */
export async function solveNeedBracket(
  evaluate: (faceValue: number) => Promise<number>,
  opts: { target: number; cap: number; tolerance: number; maxIterations: number },
): Promise<{ status: "solved" | "exceeds-cap"; faceValue: number; achievedScore: number }> {
  const { target, cap, tolerance, maxIterations } = opts;

  // "Already funded": if the survivor meets target at $0 face, no insurance.
  // Normal targets keep a ±tolerance comfort band; tiny targets (<= tolerance)
  // clamp to strict >= target so the band can't dip below 0 (F16) and so the
  // fall-through always satisfies atZero < target (preserving the bracket).
  const atZero = await evaluate(0);
  const fundedThreshold = target > tolerance ? target - tolerance : target;
  if (atZero >= fundedThreshold) {
    return { status: "solved", faceValue: 0, achievedScore: atZero };
  }

  // If even the CAP cannot reach the target score, the need exceeds our range.
  // No tolerance offset here (F1/F7): any atCap genuinely below target declares
  // exceeds-cap, guaranteeing the fall-through bracket has atCap >= target.
  const atCap = await evaluate(cap);
  if (atCap < target) {
    return { status: "exceeds-cap", faceValue: cap, achievedScore: atCap };
  }

  // Bracket is valid: atZero < target <= atCap. Solve via Illinois-modified
  // false position (success rate is monotonic in face value under a fixed seed).
  const root = await findRootAsync(
    { lo: 0, flo: atZero, hi: cap, fhi: atCap, target, tol: tolerance, maxIterations },
    evaluate,
  );
  return { status: "solved", faceValue: Math.round(root.x), achievedScore: root.fx };
}

/**
 * Full-trial refinement of a coarse-phase verdict. Phase A runs the bracket +
 * root-find cheaply at a low trial count; this confirms / sharpens it at the
 * full trial count so the REPORTED face value is always governed by the
 * full-trial objective (same semantics as a single-phase solve).
 *
 * `evaluateFull` runs Monte Carlo at the full trial count. Any ambiguous case —
 * a coarse verdict the full-trial objective disagrees with, or a bracket the
 * refine can't cheaply establish — falls back to a full single-phase
 * `solveNeedBracket(evaluateFull, opts)`, so refinement can never do worse than
 * today's solve.
 */
export async function refineNeed(
  evaluateFull: (faceValue: number) => Promise<number>,
  coarse: { status: "solved" | "exceeds-cap"; faceValue: number; achievedScore: number },
  opts: { target: number; cap: number; tolerance: number; maxIterations: number },
): Promise<{ status: "solved" | "exceeds-cap"; faceValue: number; achievedScore: number }> {
  const { target, cap, tolerance } = opts;
  const fundedThreshold = target > tolerance ? target - tolerance : target;

  if (coarse.status === "exceeds-cap") {
    const fcap = await evaluateFull(cap);
    if (fcap < target) {
      return { status: "exceeds-cap", faceValue: cap, achievedScore: fcap };
    }
    return solveNeedBracket(evaluateFull, opts); // coarse over-stated the need
  }

  if (coarse.faceValue === 0) {
    const f0 = await evaluateFull(0);
    if (f0 >= fundedThreshold) {
      return { status: "solved", faceValue: 0, achievedScore: f0 };
    }
    return solveNeedBracket(evaluateFull, opts); // not actually funded at full trials
  }

  return refineAroundFace(evaluateFull, coarse.faceValue, opts);
}

/**
 * Establish a tight full-trial bracket around the coarse root `Fc` and run the
 * Illinois root-find inside it. Widens outward (×2, small guard); if it cannot
 * cheaply bracket the full-trial root, falls back to a full solve.
 */
async function refineAroundFace(
  evaluateFull: (faceValue: number) => Promise<number>,
  Fc: number,
  opts: { target: number; cap: number; tolerance: number; maxIterations: number },
): Promise<{ status: "solved" | "exceeds-cap"; faceValue: number; achievedScore: number }> {
  const { target, cap, tolerance, maxIterations } = opts;
  const fFc = await evaluateFull(Fc);
  if (Math.abs(fFc - target) <= tolerance) {
    return { status: "solved", faceValue: Math.round(Fc), achievedScore: fFc };
  }

  const WIDEN_GUARD = 6;
  let lo: number, flo: number, hi: number, fhi: number;
  let delta = Math.max(0.15 * Fc, 1000);

  if (fFc < target) {
    // Root is above Fc; Fc is the lower endpoint, expand upward for hi.
    lo = Fc;
    flo = fFc;
    hi = Math.min(Fc + delta, cap);
    fhi = await evaluateFull(hi);
    for (let g = 0; fhi < target && hi < cap && g < WIDEN_GUARD; g++) {
      delta *= 2;
      hi = Math.min(Fc + delta, cap);
      fhi = await evaluateFull(hi);
    }
    if (fhi < target) return solveNeedBracket(evaluateFull, opts);
  } else {
    // Root is below Fc; Fc is the upper endpoint, expand downward for lo.
    hi = Fc;
    fhi = fFc;
    lo = Math.max(Fc - delta, 0);
    flo = await evaluateFull(lo);
    for (let g = 0; flo >= target && lo > 0 && g < WIDEN_GUARD; g++) {
      delta *= 2;
      lo = Math.max(Fc - delta, 0);
      flo = await evaluateFull(lo);
    }
    if (flo >= target) return solveNeedBracket(evaluateFull, opts);
  }

  const root = await findRootAsync(
    { lo, flo, hi, fhi, target, tol: tolerance, maxIterations },
    evaluateFull,
  );
  return { status: "solved", faceValue: Math.round(root.x), achievedScore: root.fx };
}

/**
 * Bisect on `faceValue` to find the minimum death benefit such that the
 * survivor's plan achieves a Monte Carlo success rate of at least
 * `assumptions.mcTargetScore`.
 *
 * The `requiredMinimumAssetLevel` on `mcPayload` is the leave-to-heirs floor:
 * a trial "succeeds" only if the survivor ends with at least that asset level.
 * The caller (Task 13) sets it from the LI assumptions' `leaveToHeirsAmount`.
 *
 * Returns:
 *   - `{ status: "solved", faceValue: 0 }` when the survivor already meets the
 *     target score without any insurance.
 *   - `{ status: "solved", faceValue: N }` when N ∈ (0, CAP] meets the target
 *     score within SCORE_TOLERANCE.
 *   - `{ status: "exceeds-cap", faceValue: CAP }` when even CAP cannot reach it.
 */
export async function solveLifeInsuranceNeedMc(
  data: ClientData,
  deceased: "client" | "spouse",
  assumptions: LifeInsuranceAssumptions & { mcTargetScore: number },
  mcPayload: MonteCarloPayload,
  opts: SolveLifeInsuranceNeedMcOptions = {},
): Promise<NeedMcResult> {
  const trials = opts.trials ?? DEFAULT_TRIALS;
  const coarseTrials = opts.coarseTrials ?? DEFAULT_COARSE_TRIALS;
  const target = assumptions.mcTargetScore;
  const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.segments]));
  const total = EXPECTED_EVALUATIONS;

  let iterations = 0;

  /** Build an `evaluate(faceValue) => score` bound to a specific trial count. A
   *  fresh return engine with the SAME seed is created each call so the RNG
   *  stream restarts identically — only the face value moves, keeping the score
   *  monotonic in face value (a prerequisite for the root-find). */
  const makeEvaluate =
    (trialCount: number) =>
    async (faceValue: number): Promise<number> => {
      if (opts.signal?.aborted) throw new Error("aborted");
      iterations += 1;
      const tree = buildLifeInsuranceWhatIfData({
        data,
        deceased,
        deathYear: assumptions.deathYear,
        faceValue,
        proceedsGrowthRate: assumptions.proceedsGrowthRate,
        proceedsRealization: assumptions.proceedsRealization,
        livingExpenseAtDeath: assumptions.livingExpenseAtDeath,
        payoffLiabilityIds: assumptions.payoffLiabilityIds,
      });
      const returnEngine = createReturnEngine({
        indices: mcPayload.indices,
        correlation: mcPayload.correlation,
        seed: mcPayload.seed,
      });
      const mc = await runMonteCarlo({
        data: tree,
        returnEngine,
        accountMixes,
        trials: trialCount,
        requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
        signal: opts.signal,
        yieldEvery: 50,
      });
      opts.onProgress?.(Math.min(iterations, total), total);
      return mc.successRate;
    };

  const bracketOpts = {
    target,
    cap: CAP,
    tolerance: SCORE_TOLERANCE,
    maxIterations: MAX_ITERATIONS,
  };

  // Phase A: cheap coarse bracket + root-find (skipped when it would give no
  // benefit). Phase B: confirm / sharpen at full trials — the reported face and
  // score always come from the full-trial refine.
  let result;
  if (coarseTrials >= trials) {
    result = await solveNeedBracket(makeEvaluate(trials), bracketOpts);
  } else {
    const coarse = await solveNeedBracket(makeEvaluate(coarseTrials), bracketOpts);
    result = await refineNeed(makeEvaluate(trials), coarse, bracketOpts);
  }
  return { ...result, iterations };
}
