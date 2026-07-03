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
