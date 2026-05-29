import type { AssetClassWeight } from "./benchmarks";
import type { AccountAllocationResult } from "./allocation";

export type EntityType = "asset_class" | "account" | "category" | "custom_group" | "model_portfolio";

export interface AggregateInput { value: number; result: AccountAllocationResult; }

export interface AggregateResult {
  /** Normalized over classified dollars (sums to 1, or empty when nothing classified). */
  weights: AssetClassWeight[];
  totalValue: number;
  /** Portion of totalValue with no asset-class mix (0..1). */
  residualUnallocatedPct: number;
}

/** Value-weight a set of accounts into one normalized asset-class weight vector. */
export function aggregateWeights(members: AggregateInput[]): AggregateResult {
  const dollarsByClass = new Map<string, number>();
  let classifiedDollars = 0;
  let totalValue = 0;

  for (const m of members) {
    totalValue += m.value;
    if ("unallocated" in m.result) continue;
    for (const row of m.result.classified) {
      const dollars = m.value * row.weight;
      dollarsByClass.set(row.assetClassId, (dollarsByClass.get(row.assetClassId) ?? 0) + dollars);
      classifiedDollars += dollars;
    }
  }

  const weights: AssetClassWeight[] =
    classifiedDollars > 0
      ? Array.from(dollarsByClass.entries())
          .map(([assetClassId, dollars]) => ({ assetClassId, weight: dollars / classifiedDollars }))
          .sort((a, b) => b.weight - a.weight)
      : [];

  const residualUnallocatedPct = totalValue > 0 ? 1 - classifiedDollars / totalValue : 1;

  return { weights, totalValue, residualUnallocatedPct };
}
