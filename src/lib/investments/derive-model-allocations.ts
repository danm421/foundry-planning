// Pure fold: a fund portfolio's look-through → model-portfolio allocation rows.
// Framework-free — no DB/Next imports.
//
// Two sources of unclassified weight are summed: holdings whose ticker never
// resolved to a security (already counted by `computeLookThrough`) and resolved
// slugs this firm has no asset class for (counted here). Both dilute the mix the
// same way, so the gate must judge their total — 3% of each is 6% of dilution,
// and looking at either half alone would wave it through.

/** Refuse to derive above this much unclassified weight. Normalizing a large
 *  residual silently reallocates unknown holdings into whatever *did* classify,
 *  overstating both return and liquidity. */
export const MAX_UNCLASSIFIED = 0.05;

export interface DeriveResult {
  ok: boolean;
  /** Normalized to sum to exactly 1.0. Empty whenever `ok` is false. */
  allocations: { assetClassId: string; weight: number }[];
  unclassifiedWeight: number;
  /** Slugs the look-through produced that this firm has no asset class for. */
  droppedSlugs: string[];
}

export function deriveModelAllocations(
  lookThrough: {
    allocation: { slug: string; weight: number }[];
    unclassifiedWeight: number;
  },
  slugToAssetClassId: Record<string, string>,
): DeriveResult {
  const byAssetClass = new Map<string, number>();
  const droppedSlugs: string[] = [];
  let droppedWeight = 0;

  for (const { slug, weight } of lookThrough.allocation) {
    const assetClassId = slugToAssetClassId[slug];
    if (!assetClassId) {
      droppedSlugs.push(slug);
      droppedWeight += weight;
      continue;
    }
    byAssetClass.set(assetClassId, (byAssetClass.get(assetClassId) ?? 0) + weight);
  }

  const unclassifiedWeight = lookThrough.unclassifiedWeight + droppedWeight;
  const classified = [...byAssetClass.values()].reduce((s, w) => s + w, 0);

  if (classified <= 0 || unclassifiedWeight > MAX_UNCLASSIFIED) {
    return { ok: false, allocations: [], unclassifiedWeight, droppedSlugs };
  }

  return {
    ok: true,
    allocations: [...byAssetClass.entries()].map(([assetClassId, weight]) => ({
      assetClassId,
      weight: weight / classified,
    })),
    unclassifiedWeight,
    droppedSlugs,
  };
}
