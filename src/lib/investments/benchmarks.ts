export interface ModelPortfolioLite {
  id: string;
  name: string;
}

export interface AssetClassWeight {
  assetClassId: string;
  weight: number;
}

/**
 * Resolve an advisor-selected model portfolio to a list of (assetClassId, weight).
 * Returns null when the portfolio id is unknown, unset, or has no allocations.
 */
export function resolveBenchmark(
  portfolioId: string | null | undefined,
  portfolios: ModelPortfolioLite[],
  allocationsByPortfolio: Record<string, AssetClassWeight[]>,
): AssetClassWeight[] | null {
  if (!portfolioId) return null;
  const portfolio = portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) return null;
  const allocations = allocationsByPortfolio[portfolioId];
  if (!allocations || allocations.length === 0) return null;
  return allocations;
}
