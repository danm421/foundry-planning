/** Project FMV/share for a future year from the start-year price.
 *  Past years clamp to the base (we never reconstruct historical prices). */
export function projectFmv(basePrice: number, growthRate: number, year: number, startYear: number): number {
  const fwd = Math.max(0, year - startYear);
  return basePrice * (1 + growthRate) ** fwd;
}

/** A plan's price curve: year → projected FMV per share. One definition so the
 *  price that DECIDES an exercise cannot drift from the price that BOOKS it. */
export function fmvCurve(
  plan: { pricePerShare: number; growthRate: number },
  planStartYear: number,
): (year: number) => number {
  return (year) => projectFmv(plan.pricePerShare, plan.growthRate, year, planStartYear);
}

/** Resolve the per-share strike. Explicit strike wins; else a discount off the
 *  exercise-year FMV; else 0 (RSUs have no strike). */
export function resolveStrikePrice(
  grant: { strikePrice?: number | null; strikeDiscountPct?: number | null },
  fmvAtExercise: number,
): number {
  if (grant.strikePrice != null) return grant.strikePrice;
  if (grant.strikeDiscountPct != null) return fmvAtExercise * (1 - grant.strikeDiscountPct);
  return 0;
}
