// src/lib/solver/warm-start.ts
//
// Deterministic warm start for the MC goal-seek solvers. A straightline
// projection costs ~1/250th of one 250-trial MC probe, so localizing the
// answer deterministically before any MC evaluation removes the expensive
// endpoint probes and wide-bracket iterations from the MC bisection. See
// specs/2026-07-03-solver-warm-start-design.md.
//
// Pure: evaluators are injected; no engine value imports beyond the shared
// liquid-total helper (mirrors the MC success classifier in
// engine/monteCarlo/trial.ts).
import { liquidPortfolioTotal } from "@/engine";
import type { ProjectionYear } from "@/engine/types";
import { snapToStep } from "./bisect";

/** Deterministic twin of the MC per-trial success classifier: liquid portfolio
 *  (taxable + cash + retirement) never negative in any year AND final-year
 *  liquid total >= the required minimum asset level. */
export function straightlineSucceeds(
  years: Pick<ProjectionYear, "portfolioAssets">[],
  requiredMinimum: number,
): boolean {
  if (years.length === 0) return false;
  let last = 0;
  for (const year of years) {
    last = liquidPortfolioTotal(year);
    if (last < 0) return false;
  }
  return last >= requiredMinimum;
}

export interface DeterministicLocalizeInput {
  lo: number;
  hi: number;
  /** Grid step; the returned seed lands on lo + n*step. */
  step: number;
  /** Straightline success at a candidate lever value. Monotone in the lever
   *  (same assumption the MC bisect already makes). */
  succeeds: (value: number) => Promise<boolean>;
}

/** Binary-search the success/failure boundary of a monotone straightline
 *  predicate. Returns the succeeding grid value adjacent to the boundary, or
 *  null when both endpoints agree (predicate uninformative for this lever —
 *  expected for roth-conversion-amount, whose PoS effect is tax/RMD timing). */
export async function deterministicLocalize(
  input: DeterministicLocalizeInput,
): Promise<number | null> {
  const { lo, hi, step, succeeds } = input;
  const sLo = await succeeds(lo);
  const sHi = await succeeds(hi);
  if (sLo === sHi) return null;
  // Invariant: `good` succeeds, `bad` fails; the boundary lies between them.
  let good = sLo ? lo : hi;
  let bad = sLo ? hi : lo;
  while (Math.abs(good - bad) > step) {
    const mid = snapToStep((good + bad) / 2, lo, step, hi);
    if (mid === good || mid === bad) break;
    if (await succeeds(mid)) {
      good = mid;
    } else {
      bad = mid;
    }
  }
  return good;
}

/** Assumed PoS-points-per-grid-step slope for the FIRST secant hop, when only
 *  one MC point is known. Deliberately shallow so the first hop overshoots
 *  toward the target rather than crawling; the clamp below bounds the damage
 *  of a bad prior in both directions. */
export const FIRST_STEP_POS_SLOPE = 0.015;
export const WARM_START_MAX_PROBES = 4;

export type WarmStartOutcome =
  | { kind: "bracket"; lo: number; hi: number; posLo: number; posHi: number }
  | {
      kind: "result";
      status: "converged" | "unreachable";
      solvedValue: number;
      achievedPoS: number;
    }
  | { kind: "fallback" };

export interface BracketFromSeedInput {
  /** Deterministic seed from deterministicLocalize, on the grid. */
  seed: number;
  lo: number;
  hi: number;
  step: number;
  /** +1 if PoS increases with lever value, -1 if it decreases. */
  direction: 1 | -1;
  /** Target PoS in (0, 1). */
  target: number;
  /** MC-probe budget. Default WARM_START_MAX_PROBES. */
  maxProbes?: number;
  /** PoS at a candidate value, at search trial count. */
  evaluate: (value: number) => Promise<number>;
}

/** Secant-step MC probes outward from the deterministic seed until two probes
 *  straddle the target PoS. Returns the straddling pair as a bisect-ready
 *  bracket (endpoint PoS included), an early result when an endpoint resolves
 *  the solve (both-beat / unreachable, mirroring bisect's shortcuts), or
 *  fallback when the budget runs out — in which case the caller runs the
 *  full-range bisect exactly as before this feature. */
export async function bracketFromSeed(
  input: BracketFromSeedInput,
): Promise<WarmStartOutcome> {
  const { lo, hi, step, direction, target, evaluate } = input;
  const maxProbes = input.maxProbes ?? WARM_START_MAX_PROBES;
  // Monotonicity ⇒ PoS is maximized at one endpoint (unreachable check) and
  // the lever is "cheapest" (most spend / least savings) at the other
  // (both-beat check). Matches bisect's endpoint semantics.
  const posMaxEnd = direction === 1 ? hi : lo;
  const cheapEnd = direction === 1 ? lo : hi;

  const points: { v: number; pos: number }[] = [];
  const probed = new Set<number>();

  // Tightest adjacent pair (by value) with PoS straddling the target.
  const findBracket = (): WarmStartOutcome | null => {
    const sorted = [...points].sort((a, b) => a.v - b.v);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const above = direction === 1 ? b : a; // higher-PoS side under monotonicity
      const below = direction === 1 ? a : b;
      if (above.pos >= target && below.pos < target) {
        return { kind: "bracket", lo: a.v, hi: b.v, posLo: a.pos, posHi: b.pos };
      }
    }
    return null;
  };

  let candidate = snapToStep(input.seed, lo, step, hi);
  while (points.length < maxProbes) {
    if (probed.has(candidate)) {
      // Secant re-proposed a probed grid value: the crossing sits within one
      // step of it. Nudge one step toward the target side; boxed in → fallback.
      const last = points[points.length - 1];
      const sign = (last.pos < target ? 1 : -1) * direction;
      const nudged = candidate + sign * step;
      if (nudged < lo || nudged > hi || probed.has(nudged)) return { kind: "fallback" };
      candidate = nudged;
    }
    const pos = await evaluate(candidate);
    probed.add(candidate);
    points.push({ v: candidate, pos });

    const bracket = findBracket();
    if (bracket) return bracket;

    // Endpoint resolutions — bisect's shortcut cases, detected without
    // probing both endpoints up front.
    if (candidate === posMaxEnd && pos < target) {
      return {
        kind: "result",
        status: "unreachable",
        solvedValue: posMaxEnd,
        achievedPoS: pos,
      };
    }
    if (candidate === cheapEnd && pos >= target) {
      return {
        kind: "result",
        status: "converged",
        solvedValue: cheapEnd,
        achievedPoS: pos,
      };
    }

    candidate = nextProbe(points, { lo, hi, step, direction, target });
  }
  return { kind: "fallback" };
}

/** Next probe value: secant through the last two points, or the prior-slope
 *  first hop when only one point exists. Degenerate secant (flat curve so
 *  far) jumps to the endpoint PoS must move toward, which the caller then
 *  resolves as a bracket, both-beat, or unreachable. */
function nextProbe(
  points: { v: number; pos: number }[],
  cfg: { lo: number; hi: number; step: number; direction: 1 | -1; target: number },
): number {
  const last = points[points.length - 1];
  const needUp = last.pos < cfg.target; // PoS must increase from here
  const sign = (needUp ? 1 : -1) * cfg.direction;
  let x: number;
  if (points.length >= 2) {
    const prev = points[points.length - 2];
    const slope = (last.pos - prev.pos) / (last.v - prev.v);
    if (!Number.isFinite(slope) || slope === 0) {
      return needUp === (cfg.direction === 1) ? cfg.hi : cfg.lo;
    }
    const rawSteps = Math.abs((cfg.target - last.pos) / slope) / cfg.step;
    // Damp runaway extrapolation from a near-flat two-point slope: cap this
    // hop at half the remaining room to the boundary the secant is heading
    // toward. Two samples with barely-different PoS produce a huge implied
    // slope-inverse and can otherwise jump straight to lo/hi in one hop,
    // which the caller then treats as a deliberate endpoint probe
    // (unreachable/both-beat) — a false positive when those two samples
    // simply don't carry enough signal yet. Halving guarantees the hop
    // approaches but never reaches the boundary from a finite slope, so the
    // probe budget (not a spurious endpoint hit) is what ends the search.
    const roomSteps = Math.abs((sign === 1 ? cfg.hi : cfg.lo) - last.v) / cfg.step;
    const steps = Math.min(rawSteps, roomSteps * 0.5);
    x = last.v + sign * steps * cfg.step;
  } else {
    const stepsWanted = Math.abs(cfg.target - last.pos) / FIRST_STEP_POS_SLOPE;
    const steps = Math.min(Math.max(stepsWanted, 2), (0.2 * (cfg.hi - cfg.lo)) / cfg.step);
    x = last.v + sign * steps * cfg.step;
  }
  return snapToStep(x, cfg.lo, cfg.step, cfg.hi);
}
