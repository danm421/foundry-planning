/** A normalized asset-class → weight map. */
export type AllocationMap = Map<string, number>;

/** Fraction of a portfolio that must be sold to move from `oldAlloc` to
 *  `newAlloc`: the sum of positive weight decreases. When either allocation is
 *  unknown (no asset-class weights), the switch is a full turnover → 1. */
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
