/** Holding-period rules for equity compensation — the ONE place the plan
 *  decides whether shares have been held long enough.
 *
 *  ⚠️ Every rule here reads WHOLE YEARS, because whole years are all the
 *  database stores: a vesting row carries a vest YEAR and share counts, and
 *  `lib/projection/load-equity.ts` truncates every date it reads to its year.
 *  Two year integers cannot express "more than twelve months" — a 2027 vest and
 *  a 2028 sale is anywhere from one month to twenty-three. So each rule takes
 *  the CONSERVATIVE reading: it grants long-term / qualifying treatment only
 *  where the whole-year gap makes it certain, and over-taxes the ambiguous
 *  middle. Audit F26/F27.
 *
 *  This module exists because the two answers had drifted a full year apart.
 *  The Vesting Schedule asked `max(grantYear + 2, vestYear + 1)` while the tax
 *  ledger asked `>= 3` and `>= 2`, so a badge could promise long-term rates on a
 *  sale the very same plan taxed as ordinary income (audit F17/F47). Both
 *  readings were wrong; making them one reading at least makes the plan
 *  internally honest.
 *
 *  🚧 G8 replaces the INPUTS, not the rules. Once real grant, exercise and sale
 *  dates are stored, callers pass dates and these become the ordinary
 *  §422(a)(1) and §1222(3) tests. Moving the thresholds before the dates exist
 *  only makes the plan consistently wrong in a different direction.
 */

/** A qualifying ISO disposition under IRC §422(a)(1): held more than two years
 *  from grant AND more than one year from exercise. On whole years that is
 *  `>= 3` and `>= 2` — one lower and the gap could be as little as a month. */
export function isQualifyingIsoDisposition(a: {
  grantYear: number;
  exerciseYear: number;
  dispositionYear: number;
}): boolean {
  return a.dispositionYear - a.grantYear >= 3 && a.dispositionYear - a.exerciseYear >= 2;
}

/** Long-term capital gain under IRC §1222(3): held more than one year. On whole
 *  years that is a gap of two. */
export function isLongTermHolding(acquisitionYear: number, dispositionYear: number): boolean {
  return dispositionYear - acquisitionYear >= 2;
}

/** The acquisition year the plan INVENTS for shares recorded as already vested
 *  or already exercised when the plan begins.
 *
 *  ⚠️ It is a fabrication: the database records that the shares exist, never
 *  when they were acquired (audit F1). Two years before the plan start is the
 *  number `tax-events.ts` has always seeded, and the Vesting Schedule now reads
 *  the same one so the two surfaces cannot disagree about a holding period they
 *  are both guessing at. G8 stores the real date and deletes this. */
export function assumedPrePlanAcquisitionYear(planStartYear: number): number {
  return planStartYear - 2;
}
