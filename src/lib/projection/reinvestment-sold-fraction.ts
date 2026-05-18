/** An asset-class → fractional-weight map. Weights are fractions (0–1), not
 *  percentages. */
export type AllocationMap = Map<string, number>;

/** Fraction of a portfolio that must be sold to move from `oldAlloc` to
 *  `newAlloc`: the sum of positive weight decreases. When either allocation is
 *  unknown (no asset-class weights), the switch is a full turnover → 1.
 *
 *  Model-portfolio maps sum to ~1 by convention. An account asset-mix map may
 *  sum to <1, leaving an implicit unclassified remainder that is NOT counted as
 *  turnover — a conservative choice that slightly under-counts turnover for
 *  asset-mix-base accounts, which is the safe direction for a tax estimate. */
export function soldFraction(
  oldAlloc: AllocationMap | undefined,
  newAlloc: AllocationMap | undefined,
): number {
  if (!oldAlloc || oldAlloc.size === 0) return 1;
  if (!newAlloc || newAlloc.size === 0) return 1;
  let sold = 0;
  for (const [assetClassId, oldWeight] of oldAlloc) {
    const newWeight = newAlloc.get(assetClassId) ?? 0;
    if (oldWeight > newWeight) sold += oldWeight - newWeight;
  }
  return Math.min(1, sold);
}
