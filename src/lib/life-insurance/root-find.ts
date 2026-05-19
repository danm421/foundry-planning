// src/lib/life-insurance/root-find.ts
//
// Illinois-modified false-position (regula-falsi) root-finder.
//
// Both life-insurance need solvers search for the face value at which a
// monotonic-increasing objective hits a target: the deterministic solver's
// ending-portfolio (solve-need.ts) and the Monte Carlo solver's success rate
// (solve-need-mc.ts). The objective is monotonic and very nearly linear in
// face value, so a structure-aware bracketing method converges in ~4-6 probes
// where plain bisection needs ~24.
//
// "Illinois" is the weight-halving modification that fixes plain false
// position's classic failure mode: when one bracket endpoint is retained for
// many iterations, its stale objective value drags interpolation to a crawl.
// Halving the stale endpoint's value each time it is retained restores fast
// convergence. The method stays a *bracketing* method -- the root can never
// escape [lo, hi] -- so it is as robust as bisection.

export interface RootFindInput {
  /** Bracket lower bound and its (already-computed) objective value. */
  lo: number;
  flo: number;
  /** Bracket upper bound and its (already-computed) objective value. */
  hi: number;
  fhi: number;
  /** Objective target. The root is the x where f(x) === target. */
  target: number;
  /** Converged once |f(x) - target| <= tol. */
  tol: number;
  /** Hard cap on objective evaluations inside the loop. */
  maxIterations: number;
}

export interface RootFindResult {
  /** The converged x. */
  x: number;
  /** f(x) at the converged x. */
  fx: number;
  /** Objective evaluations performed inside the loop (excludes the two
   *  pre-supplied endpoint values). */
  iterations: number;
}

/**
 * Synchronous Illinois-modified false position.
 *
 * Preconditions (caller-guaranteed): `f` is monotonic non-decreasing on
 * [lo, hi], and the target is bracketed -- `flo <= target <= fhi`.
 */
export function findRoot(
  input: RootFindInput,
  f: (x: number) => number,
): RootFindResult {
  let { lo, hi, flo, fhi } = input;
  const { target, tol, maxIterations } = input;

  // Work in g(x) = f(x) - target space; the root is g(x) = 0.
  let glo = flo - target;
  let ghi = fhi - target;
  let x = hi;
  let gx = ghi;
  let iterations = 0;
  let lastSide: -1 | 0 | 1 = 0;

  for (let i = 0; i < maxIterations; i++) {
    // False-position interpolation; fall back to the midpoint if the
    // endpoints are flat (denominator 0 -> NaN) or the guess escapes (lo, hi).
    const denom = ghi - glo;
    x = denom === 0 ? (lo + hi) / 2 : hi - (ghi * (hi - lo)) / denom;
    if (!(x > lo && x < hi)) x = (lo + hi) / 2;

    gx = f(x) - target;
    iterations += 1;
    if (Math.abs(gx) <= tol) break;

    if (gx < 0) {
      // x sits below the root -> it becomes the new lower endpoint.
      lo = x;
      glo = gx;
      if (lastSide === -1) ghi *= 0.5; // Illinois: deflate the stale hi value.
      lastSide = -1;
    } else {
      // x sits above the root -> it becomes the new upper endpoint.
      hi = x;
      ghi = gx;
      if (lastSide === 1) glo *= 0.5; // Illinois: deflate the stale lo value.
      lastSide = 1;
    }
  }

  return { x, fx: gx + target, iterations };
}

/**
 * Asynchronous mirror of `findRoot` -- identical algorithm, awaits the
 * objective. Used by the Monte Carlo solver, whose objective evaluation runs
 * `runMonteCarlo`. A rejection thrown by `f` (e.g. an abort signal) propagates
 * unchanged.
 */
export async function findRootAsync(
  input: RootFindInput,
  f: (x: number) => Promise<number>,
): Promise<RootFindResult> {
  let { lo, hi, flo, fhi } = input;
  const { target, tol, maxIterations } = input;

  let glo = flo - target;
  let ghi = fhi - target;
  let x = hi;
  let gx = ghi;
  let iterations = 0;
  let lastSide: -1 | 0 | 1 = 0;

  for (let i = 0; i < maxIterations; i++) {
    const denom = ghi - glo;
    x = denom === 0 ? (lo + hi) / 2 : hi - (ghi * (hi - lo)) / denom;
    if (!(x > lo && x < hi)) x = (lo + hi) / 2;

    gx = (await f(x)) - target;
    iterations += 1;
    if (Math.abs(gx) <= tol) break;

    if (gx < 0) {
      lo = x;
      glo = gx;
      if (lastSide === -1) ghi *= 0.5;
      lastSide = -1;
    } else {
      hi = x;
      ghi = gx;
      if (lastSide === 1) glo *= 0.5;
      lastSide = 1;
    }
  }

  return { x, fx: gx + target, iterations };
}
