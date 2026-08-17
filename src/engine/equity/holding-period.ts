/** Holding-period rules for equity compensation — the ONE place the plan
 *  decides whether shares have been held long enough.
 *
 *  Every rule reads REAL DATES. G8 added `acquired_on` to a vesting row and
 *  carried grant, vest and sale dates through the loader unmodified, so the
 *  statutory tests can be the statutory tests. The predecessor read whole-year
 *  integers, could not tell one month from twenty-three, and deliberately
 *  over-taxed the ambiguous middle to stay conservative (audit F26/F27); with
 *  real dates there is no ambiguous middle left to be conservative about.
 *
 *  Both tests are STRICT. "More than one year" is not "one year or more" — a
 *  sale on the first anniversary is short-term (Rev. Rul. 66-7 counts the
 *  holding period from the day after acquisition), and the same reading applies
 *  to §422(a)(1)'s two-year leg.
 *
 *  Dates the plan MODELS rather than records (a future exercise, a future sale)
 *  are given a date by `timeline.ts`, which owns that convention. This module
 *  never invents one.
 */

import { addYears, isStrictlyAfter } from "./dates";

/** A qualifying ISO disposition under IRC §422(a)(1): held more than two years
 *  from grant AND more than one year from exercise. Both legs, not either. */
export function isQualifyingIsoDisposition(a: {
  grantDate: string;
  exerciseDate: string;
  dispositionDate: string;
}): boolean {
  return (
    isStrictlyAfter(a.dispositionDate, addYears(a.grantDate, 2)) &&
    isStrictlyAfter(a.dispositionDate, addYears(a.exerciseDate, 1))
  );
}

/** Long-term capital gain under IRC §1222(3): held more than one year. */
export function isLongTermHolding(acquisitionDate: string, dispositionDate: string): boolean {
  return isStrictlyAfter(dispositionDate, addYears(acquisitionDate, 1));
}
