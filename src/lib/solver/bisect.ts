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
  evaluate: (value: number) => Promise<number>;
}

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
  if (posLo >= target) {
    tight = lo;
    posTight = posLo;
    loose = hi;
  } else {
    tight = hi;
    posTight = posHi;
    loose = lo;
  }

  while (iterations < maxIterations) {
    const mid = snapToStep((tight + loose) / 2, lo, step, hi);
    if (mid === tight || mid === loose) {
      // Bracket collapsed to one step — return tight (closest beating endpoint).
      return { status: "converged", solvedValue: tight, achievedPoS: posTight, iterations };
    }
    const posMid = await evaluate(mid);
    iterations += 1;
    if (Math.abs(posMid - target) <= tolerance) {
      return { status: "converged", solvedValue: mid, achievedPoS: posMid, iterations };
    }
    if (posMid >= target) {
      tight = mid;
      posTight = posMid;
    } else {
      loose = mid;
    }
  }

  return {
    status: "max-iterations",
    solvedValue: tight,
    achievedPoS: posTight,
    iterations,
  };
}
