// DB IO wrapper: load a firm's fund (ticker) portfolios + their look-through
// security slug weights, and fold each into firm-asset-class weight rows
// (the analog of model_portfolio_allocations) for the projection resolver.
// Pairs with the pure `tickerPortfolioAllocationRows` helper.
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { tickerPortfolios, tickerPortfolioHoldings, securityAssetClassWeights } from "@/db/schema";
import { tickerPortfolioAllocationRows } from "@/lib/investments/ticker-portfolio-allocation";

export interface TickerPortfolioAllocation {
  tickerPortfolioId: string;
  assetClassId: string;
  weight: string;
}

/**
 * For every fund portfolio in `firmId`, roll its holdings' look-through slug
 * weights into firm-asset-class weight rows. Returns the flattened rows the
 * growth-source resolver consumes as `tickerPortfolioAllocations`.
 * `slugToAssetClassId` maps a canonical slug → this firm's assetClassId.
 */
export async function loadTickerPortfolioAllocations(
  firmId: string,
  slugToAssetClassId: Map<string, string>,
): Promise<TickerPortfolioAllocation[]> {
  const portfolios = await db.select().from(tickerPortfolios).where(eq(tickerPortfolios.firmId, firmId));
  if (portfolios.length === 0) return [];
  const portfolioIds = portfolios.map((p) => p.id);
  const holdings = await db
    .select()
    .from(tickerPortfolioHoldings)
    .where(inArray(tickerPortfolioHoldings.tickerPortfolioId, portfolioIds));

  const securityIds = [...new Set(holdings.map((h) => h.securityId).filter(Boolean))] as string[];
  const slugWeightRows = securityIds.length
    ? await db.select().from(securityAssetClassWeights).where(inArray(securityAssetClassWeights.securityId, securityIds))
    : [];

  const slugWeightsBySecurity = new Map<string, { slug: string; weight: number }[]>();
  for (const r of slugWeightRows) {
    const list = slugWeightsBySecurity.get(r.securityId) ?? [];
    list.push({ slug: r.assetClassSlug, weight: parseFloat(r.weight) });
    slugWeightsBySecurity.set(r.securityId, list);
  }

  const slugRecord = Object.fromEntries(slugToAssetClassId);
  const out: TickerPortfolioAllocation[] = [];
  for (const p of portfolios) {
    const portfolioHoldings = holdings
      .filter((h) => h.tickerPortfolioId === p.id)
      .map((h) => ({
        weight: parseFloat(h.weight),
        slugWeights: h.securityId ? (slugWeightsBySecurity.get(h.securityId) ?? []) : [],
      }));
    for (const row of tickerPortfolioAllocationRows(portfolioHoldings, slugRecord)) {
      out.push({ tickerPortfolioId: p.id, assetClassId: row.assetClassId, weight: String(row.weight) });
    }
  }
  return out;
}
