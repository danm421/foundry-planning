/**
 * Rate guards shared by every module in `src/engine/annuity/`.
 *
 * Every rate in this engine is a FRACTION — 0.05 is 5%. The DB stores them as
 * `decimal(5,4)` with no CHECK constraint, so a percent typed where a fraction
 * belongs (`5` for 5%) is both representable and reachable, and an unparsed
 * field arrives as NaN.
 *
 * Both cases have to throw rather than flow onward, because the arithmetic
 * downstream cannot detect them: `Math.max(0, NaN)` is `NaN`, so the zero
 * floors on account values read as protection and provide none — a single NaN
 * rate propagates into every tax figure the projection reports while still
 * showing a real-looking income number. A percent-scaled fee is worse than
 * NaN: it produces finite, plausible, wrong answers.
 */

/**
 * A rate that must be a fraction in [0,1] — fees, payout percents, rollup
 * rates. The `Number.isFinite` check leads so NaN and ±Infinity are reported
 * with the same message as an out-of-range value; comparisons against NaN are
 * always false and would otherwise let it through.
 */
export function assertUnitRate(field: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} out of [0,1]: ${value}`);
  }
  return value;
}

/**
 * A rate that must merely be a real number. Used for market growth, where a
 * NEGATIVE rate is legitimate — a down year is not bad data — so no range
 * applies and only NaN/Infinity are rejected.
 */
export function assertFiniteRate(field: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} is not a finite rate: ${value}`);
  }
  return value;
}
