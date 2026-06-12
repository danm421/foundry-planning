/** Build a canonical-slug → asset-class-id map for ONE firm.
 *
 *  Asset-class slugs are unique *within* a firm (asset_classes_firm_slug_uniq)
 *  but NOT globally — every firm seeds the same canonical slugs (us_large_cap,
 *  reit, …) with its own ids. Resolving a security's slug blend therefore MUST
 *  be scoped to the account's firm; mixing firms collapses the slugs into a
 *  last-write-wins map that can hand back a foreign firm's asset-class id. When
 *  that id is persisted into account_asset_allocations it reads as 0% in the
 *  firm-scoped Asset Mix editor (the stored id matches no class in the firm),
 *  even though the holdings-derived blend still renders. Pass only the target
 *  firm's rows, or rely on this firmId filter as a defensive backstop. */
export function firmSlugToAssetClassId(
  rows: readonly { id: string; slug: string | null; firmId: string }[],
  firmId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.slug && r.firmId === firmId) map.set(r.slug, r.id);
  }
  return map;
}

/** One position to roll up. `securityWeights` is the canonical-slug blend from
 *  the security; `overrides` is the firm-assetClassId blend that wins when
 *  non-empty. A fully-manual holding has securityId=null and an override blend. */
export interface HoldingInput {
  id: string;
  securityId: string | null;
  shares: number;
  price: number;
  costBasis: number;
  /** Authoritative market value when set; else derived shares×price. */
  marketValue: number | null;
  securityWeights: { slug: string; weight: number }[];
  overrides: { assetClassId: string; weight: number }[];
}

/** Market value of one holding: the stored marketValue when present (bonds /
 *  manual positions where shares×price is not the value), else shares×price. */
export function holdingMarketValue(h: { marketValue: number | null; shares: number; price: number }): number {
  return h.marketValue ?? h.shares * h.price;
}

export interface HoldingsRollup {
  /** Σ holdingMarketValue. Authoritative account value in holdings mode. */
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
    const mv = holdingMarketValue(h);
    if (Number.isFinite(mv) && mv > 0) value += mv;
    basis += h.costBasis;
  }

  const byAssetClass = new Map<string, number>();
  if (value > 0) {
    for (const h of holdings) {
      const mv = holdingMarketValue(h);
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

/** One position to break down for the asset-class drill. Same blend inputs as
 *  HoldingInput, plus the display fields the drill renders. `costBasis` is not
 *  needed here. */
export interface HoldingForBreakdown {
  id: string;
  ticker: string;
  name: string;
  securityId: string | null;
  shares: number;
  price: number;
  /** Authoritative market value when set; else derived shares×price. */
  marketValue: number | null;
  securityWeights: { slug: string; weight: number }[];
  overrides: { assetClassId: string; weight: number }[];
}

export interface HoldingClassContribution {
  holdingId: string;
  ticker: string;
  name: string;
  /** mv × blendWeight — the dollars this holding contributes to this class. */
  valueInClass: number;
  /** This class's weight within the holding (1 for a single-class holding). */
  blendWeight: number;
}

/** Per-class breakdown of holdings, the position-level companion to
 *  rollupHoldings. Override blend wins; else the security's slug blend is mapped
 *  to firm asset-class ids (slugs with no firm id are dropped). A blended fund
 *  appears under every class it touches, carrying only its slice. Each class's
 *  list is sorted by valueInClass desc. */
export function breakdownHoldingsByClass(
  holdings: readonly HoldingForBreakdown[],
  slugToAssetClassId: ReadonlyMap<string, string>,
): Map<string, HoldingClassContribution[]> {
  const byClass = new Map<string, HoldingClassContribution[]>();
  for (const h of holdings) {
    const mv = holdingMarketValue(h);
    if (!Number.isFinite(mv) || mv <= 0) continue;

    const blend: { assetClassId: string; weight: number }[] =
      h.overrides.length > 0
        ? h.overrides
        : h.securityWeights
            .map((w) => ({ assetClassId: slugToAssetClassId.get(w.slug), weight: w.weight }))
            .filter((w): w is { assetClassId: string; weight: number } => w.assetClassId != null);

    for (const b of blend) {
      if (!Number.isFinite(b.weight) || b.weight <= 0) continue;
      const list = byClass.get(b.assetClassId) ?? [];
      list.push({
        holdingId: h.id,
        ticker: h.ticker,
        name: h.name,
        valueInClass: mv * b.weight,
        blendWeight: b.weight,
      });
      byClass.set(b.assetClassId, list);
    }
  }
  for (const list of byClass.values()) list.sort((a, b) => b.valueInClass - a.valueInClass);
  return byClass;
}
