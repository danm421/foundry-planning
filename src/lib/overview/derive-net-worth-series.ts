import type { ProjectionYear } from "@/engine";

export function deriveNetWorthSeries(projection: ProjectionYear[]): number[] {
  return projection.map((y) => {
    const assets = y.portfolioAssets.total;
    const liabilities = Object.values(y.liabilityBalancesBoY).reduce(
      (sum, v) => sum + v,
      0,
    );
    return assets - liabilities;
  });
}
