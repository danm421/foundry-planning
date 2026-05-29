/** One position to roll up. `securityWeights` is the canonical-slug blend from
 *  the security; `overrides` is the firm-assetClassId blend that wins when
 *  non-empty. A fully-manual holding has securityId=null and an override blend. */
export interface HoldingInput {
  id: string;
  securityId: string | null;
  shares: number;
  price: number;
  costBasis: number;
  securityWeights: { slug: string; weight: number }[];
  overrides: { assetClassId: string; weight: number }[];
}

export interface HoldingsRollup {
  /** Σ(shares × price). Authoritative account value in holdings mode. */
  value: number;
  /** Σ costBasis. Authoritative account basis in holdings mode. */
  basis: number;
  /** Firm assetClassId → fractional weight, value-weighted across holdings.
   *  Sums to the classified fraction; the resolver routes the residual
   *  (1 − Σweight) to the inflation fallback, matching asset_mix. */
  allocations: { assetClassId: string; weight: number }[];
}

export function rollupHoldings(
  holdings: readonly HoldingInput[],
  slugToAssetClassId: ReadonlyMap<string, string>,
): HoldingsRollup {
  let value = 0;
  let basis = 0;
  for (const h of holdings) {
    const mv = h.shares * h.price;
    if (Number.isFinite(mv) && mv > 0) value += mv;
    basis += h.costBasis;
  }

  const byAssetClass = new Map<string, number>();
  if (value > 0) {
    for (const h of holdings) {
      const mv = h.shares * h.price;
      if (!Number.isFinite(mv) || mv <= 0) continue;
      const holdingWeight = mv / value;

      // Override blend wins; else map the security's slug blend to firm ids.
      const blend: { assetClassId: string; weight: number }[] =
        h.overrides.length > 0
          ? h.overrides
          : h.securityWeights
              .map((w) => ({ assetClassId: slugToAssetClassId.get(w.slug), weight: w.weight }))
              .filter((w): w is { assetClassId: string; weight: number } => w.assetClassId != null);

      for (const b of blend) {
        if (!Number.isFinite(b.weight) || b.weight <= 0) continue;
        byAssetClass.set(
          b.assetClassId,
          (byAssetClass.get(b.assetClassId) ?? 0) + holdingWeight * b.weight,
        );
      }
    }
  }

  const allocations = [...byAssetClass.entries()]
    .map(([assetClassId, weight]) => ({ assetClassId, weight }))
    .sort((a, b) => b.weight - a.weight);

  return { value, basis, allocations };
}
