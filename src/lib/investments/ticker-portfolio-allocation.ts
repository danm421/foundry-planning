// Pure helpers: roll a fund (ticker) portfolio's look-through holdings into
// firm-asset-class weight rows (the analog of model_portfolio_allocations) and
// a CMA-blended display return. Framework-free — no DB/Next imports.
import { computeLookThrough, type LookThroughHolding } from "@/lib/ticker-portfolio-service";

export interface TickerAllocationRow {
  assetClassId: string;
  weight: number;
}

/**
 * Blend a fund portfolio's holdings (each carrying canonical slug weights) into
 * firm-asset-class weight rows. Slugs with no firm asset class are dropped; the
 * dropped weight becomes an unclassified remainder downstream (foldWeighted
 * fills it with the inflation fallback), so weights here may sum to < 1.
 */
export function tickerPortfolioAllocationRows(
  holdings: { weight: number; slugWeights: { slug: string; weight: number }[] }[],
  slugToAssetClassId: Record<string, string>,
): TickerAllocationRow[] {
  // Reuse the shipped look-through fold (Σ holdingWeight × slugWeight per slug).
  const lookThroughHoldings: LookThroughHolding[] = holdings.map((h, i) => ({
    ticker: String(i),
    weight: h.weight,
    slugWeights: h.slugWeights,
  }));
  const { allocation } = computeLookThrough(lookThroughHoldings, {});
  const byAcId = new Map<string, number>();
  for (const { slug, weight } of allocation) {
    const acId = slugToAssetClassId[slug];
    if (!acId) continue; // unclassified remainder
    byAcId.set(acId, (byAcId.get(acId) ?? 0) + weight);
  }
  return [...byAcId.entries()].map(([assetClassId, weight]) => ({ assetClassId, weight }));
}

/** CMA-blended return in percent (0–100) for the dropdown, or null when nothing
 *  classifies. Uses the classified rows only (does not impute the remainder). */
export function tickerPortfolioBlendedReturnPct(
  rows: TickerAllocationRow[],
  assetClassReturns: Record<string, number>,
): number | null {
  if (rows.length === 0) return null;
  let blended = 0;
  for (const { assetClassId, weight } of rows) {
    blended += weight * (assetClassReturns[assetClassId] ?? 0);
  }
  return Math.round(blended * 10000) / 100;
}
