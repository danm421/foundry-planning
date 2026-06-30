// src/lib/solver/bisect.ts
//
// Pure async bisection on a single scalar lever. The caller passes an
// `evaluate(value) => Promise<PoS>` closure — bisect makes no assumptions
// about how PoS is computed.
//
// Algorithm:
//   1. Probe lo and hi.
//   2. If both beat target → return "cheaper" endpoint (smallest lever cost,
//      direction-dependent).
//   3. If neither beats target → return endpoint with max PoS, status="unreachable".
//   4. Otherwise maintain a tight/loose bracket (tight beats, loose misses) and
//      bisect until tolerance hit, bracket collapses to one step, or max iters.

export interface BisectInput {
  lo: number;
  hi: number;
  /** Smallest allowed bracket width. Mid is snapped to lo + n*step. */
  step: number;
  /** +1 if PoS increases with lever value, -1 if decreases. */
  direction: 1 | -1;
  /** Target PoS in (0, 1). */
  target: number;
  /** Default 0.02 (±2% PoS). */
  tolerance?: number;
  /** Default 8 (counts endpoint probes). */
  maxIterations?: number;
  /** How to pick the answer once the bracket has narrowed to one step.
   *  - "beat-target" (default): the tight endpoint, i.e. the value with PoS ≥
   *    target (maximizes/secures the lever while staying at or above target).
   *  - "closest": whichever of the two adjacent endpoints has PoS nearest the
   *    target, even when that endpoint sits slightly BELOW target. Used by the
   *    maximize-spend levers so the reported spend snaps to the step whose PoS is
   *    closest to the requested probability. Only changes the bracket-collapse /
   *    max-iterations result — the both-beat and unreachable shortcuts are
   *    unchanged (so an unreachable plan never jumps to max spend). */
  selection?: "beat-target" | "closest";
  evaluate: (value: number) => Promise<number>;
}

/** Iteration budget for bisecting a wide lever range (savings/roth) down to its
 *  step: ~log2(range/step) bisections plus the two endpoint probes. The default
 *  of 8 suits narrow age levers but exits short of the true minimum on wide
 *  ranges, so the live PoS and funding solvers pass this instead. */
export const WIDE_LEVER_MAX_ITERATIONS = 24;

export type BisectStatus = "converged" | "unreachable" | "max-iterations";

export interface BisectResult {
  status: BisectStatus;
  solvedValue: number;
  achievedPoS: number;
  iterations: number;
}

function snapToStep(value: number, lo: number, step: number, hi: number): number {
  const n = Math.round((value - lo) / step);
  const snapped = lo + n * step;
  // Avoid floating-point drift on small steps (e.g. 0.01).
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const rounded = Number(snapped.toFixed(decimals + 4));
  return Math.min(hi, Math.max(lo, rounded));
}

export async function bisect(input: BisectInput): Promise<BisectResult> {
  const { lo, hi, step, direction, target, evaluate } = input;
  const tolerance = input.tolerance ?? 0.02;
  const maxIterations = input.maxIterations ?? 8;
  const selection = input.selection ?? "beat-target";

  const posLo = await evaluate(lo);
  const posHi = await evaluate(hi);
  let iterations = 2;

  if (posLo >= target && posHi >= target) {
    // Both beat target — return the cheaper endpoint.
    const useLo = direction === 1;
    return {
      status: "converged",
      solvedValue: useLo ? lo : hi,
      achievedPoS: useLo ? posLo : posHi,
      iterations,
    };
  }

  if (posLo < target && posHi < target) {
    const useLo = posLo >= posHi;
    return {
      status: "unreachable",
      solvedValue: useLo ? lo : hi,
      achievedPoS: useLo ? posLo : posHi,
      iterations,
    };
  }

  let tight: number;
  let posTight: number;
  let loose: number;
  let posLoose: number;
  if (posLo >= target) {
    tight = lo;
    posTight = posLo;
    loose = hi;
    posLoose = posHi;
  } else {
    tight = hi;
    posTight = posHi;
    loose = lo;
    posLoose = posLo;
  }

  // Illinois: when the same endpoint is retained, de-weight it so the next
  // interpolation isn't dragged toward a stalled side. null = no stale side yet.
  let stale: "tight" | "loose" | null = null;

  // Resolve the collapsed bracket to its reported value. "beat-target" keeps the
  // tight (≥ target) endpoint; "closest" returns whichever adjacent endpoint has
  // PoS nearest the target — which may be the loose one, sitting just below it.
  const resolveBracket = (): { solvedValue: number; achievedPoS: number } => {
    if (
      selection === "closest" &&
      Math.abs(posLoose - target) < Math.abs(posTight - target)
    ) {
      return { solvedValue: loose, achievedPoS: posLoose };
    }
    return { solvedValue: tight, achievedPoS: posTight };
  };

  while (iterations < maxIterations) {
    const mid = nextCandidate(
      tight, posTight, loose, posLoose, lo, hi, step, target, stale,
    );
    if (mid === tight || mid === loose) {
      // Bracket collapsed to one step — return the selection-resolved endpoint.
      return { status: "converged", ...resolveBracket(), iterations };
    }
    const posMid = await evaluate(mid);
    iterations += 1;
    if (Math.abs(posMid - target) <= tolerance) {
      return { status: "converged", solvedValue: mid, achievedPoS: posMid, iterations };
    }
    if (posMid >= target) {
      tight = mid;
      posTight = posMid;
      stale = stale === "loose" ? null : "loose";
    } else {
      loose = mid;
      posLoose = posMid;
      stale = stale === "tight" ? null : "tight";
    }
  }

  return {
    status: "max-iterations",
    ...resolveBracket(),
    iterations,
  };
}

/**
 * Next probe inside the (tight, loose) bracket. Uses regula-falsi (linear
 * interpolation through the two bracket PoS values) with an Illinois de-weight
 * on the stale endpoint. Falls back to the bisection midpoint whenever the
 * slope is zero/non-finite (flat curve) or the interpolated point would land on
 * or outside the bracket — so worst-case behaviour equals pure bisection.
 */
function nextCandidate(
  tight: number,
  posTight: number,
  loose: number,
  posLoose: number,
  lo: number,
  hi: number,
  step: number,
  target: number,
  stale: "tight" | "loose" | null,
): number {
  const ft = posTight - target;
  const fl = posLoose - target;
  const ftw = stale === "tight" ? ft / 2 : ft;
  const flw = stale === "loose" ? fl / 2 : fl;
  const denom = ftw - flw;

  let x: number;
  if (denom === 0 || !Number.isFinite(denom)) {
    x = (tight + loose) / 2; // flat-curve guard
  } else {
    x = tight + (ftw * (loose - tight)) / denom;
  }

  const snapped = snapToStep(x, lo, step, hi);
  const bisectMid = snapToStep((tight + loose) / 2, lo, step, hi);
  const within =
    snapped > Math.min(tight, loose) &&
    snapped < Math.max(tight, loose) &&
    snapped !== tight &&
    snapped !== loose;
  // Only use the interpolated point if it is at least as far from tight as the
  // bisection midpoint — this guarantees worst-case convergence equals pure
  // bisection, which is essential for the step-like, noisy PoS curves Monte
  // Carlo produces (where unguarded regula-falsi can stagnate one-sidedly).
  // Tradeoff: when the true root sits near the tight (beating) endpoint, this
  // forgoes regula-falsi's small-step speedup and falls back to bisection rate —
  // still ≥ the old pure-bisection baseline, just not maximally cheap there.
  if (within && Math.abs(snapped - tight) >= Math.abs(bisectMid - tight)) return snapped;
  // Interpolation degenerate, out of bracket, or too close to tight → bisect.
  return bisectMid;
}
