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

/** Bisection stops when the achieved MC score is within ±0.02 of the target. */
const SCORE_TOLERANCE = 0.02;

/** Maximum bisection iterations — 24 halvings of [0, 20M] resolves to <$2. */
const MAX_ITERATIONS = 24;

/** Expected total evaluations used to size the progress bar. The Illinois
 *  root-finder converges in far fewer probes than the old fixed bisection
 *  (2 endpoint probes + ~8 root-finder iterations); `done` is clamped to
 *  this value so a rare long run never overflows the bar. */
const EXPECTED_EVALUATIONS = 10;

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
  const target = assumptions.mcTargetScore;
  const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.segments]));
  const total = EXPECTED_EVALUATIONS;

  let iterations = 0;

  /** Run the Monte Carlo engine for one candidate face value and return its
   *  success rate. A fresh return engine with the SAME seed is created each
   *  call so the RNG stream restarts identically — only the face value moves,
   *  keeping the score monotonic in face value (a prerequisite for bisection). */
  const evaluate = async (faceValue: number): Promise<number> => {
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
      trials,
      requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
      signal: opts.signal,
      yieldEvery: 50,
    });
    opts.onProgress?.(Math.min(iterations, total), total);
    return mc.successRate;
  };

  // The bracket orchestration (atZero/atCap guards + Illinois root-find) lives
  // in the pure `solveNeedBracket` helper; the `evaluate` closure above still
  // owns the `iterations` counter and `onProgress` side effects.
  const result = await solveNeedBracket(evaluate, {
    target,
    cap: CAP,
    tolerance: SCORE_TOLERANCE,
    maxIterations: MAX_ITERATIONS,
  });
  return { ...result, iterations };
}
