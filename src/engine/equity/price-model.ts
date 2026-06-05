/** Project FMV/share for a future year from the start-year price.
 *  Past years clamp to the base (we never reconstruct historical prices). */
export function projectFmv(basePrice: number, growthRate: number, year: number, startYear: number): number {
  const fwd = Math.max(0, year - startYear);
  return basePrice * (1 + growthRate) ** fwd;
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
