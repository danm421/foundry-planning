import type { AssetClassWeight } from "./benchmarks";
import type { AccountAllocationResult } from "./allocation";
import type { AssetClassData } from "@/lib/portfolio-math";
import { computeStats, type RiskReturnStats, type StatsContext } from "./portfolio-stats";
import type { AssetTypeId } from "./asset-types";

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

export interface AnalysisAccount {
  id: string; name: string; category: string; value: number;
  growthSource: string; modelPortfolioId: string | null; tickerPortfolioId: string | null;
}
export interface AssetClassMeta { id: string; name: string; sortOrder: number; assetType: AssetTypeId; }
export interface CustomGroupInput { id: string; name: string; color: string | null; accountIds: string[]; }

export interface AnalysisRow {
  key: string;
  type: EntityType;
  id: string;
  name: string;
  weights: AssetClassWeight[];
  value: number | null;
  residualUnallocatedPct: number;
  stats: RiskReturnStats;
  sortOrder?: number;
  assetType?: AssetTypeId;
}
export interface UnplottableAccount { id: string; name: string; value: number; reason: string; }

export interface BuildAnalysisInput {
  assetClasses: AssetClassData[];
  assetClassMeta: AssetClassMeta[];
  accounts: AnalysisAccount[];
  resolver: (acct: { id: string }) => AccountAllocationResult;
  modelPortfolios: { id: string; name: string }[];
  modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]>;
  customGroups: CustomGroupInput[];
  ctx: StatsContext;
}

export function buildAnalysisRows(input: BuildAnalysisInput): {
  rows: AnalysisRow[];
  unplottable: UnplottableAccount[];
} {
  const { accounts, resolver, ctx } = input;
  const rows: AnalysisRow[] = [];
  const unplottable: UnplottableAccount[] = [];

  const pushFromWeights = (
    type: EntityType, id: string, name: string,
    weights: AssetClassWeight[], value: number | null, residual: number,
    extra?: { sortOrder?: number; assetType?: AssetTypeId },
  ) => {
    rows.push({
      key: `${type}:${id}`, type, id, name, weights, value,
      residualUnallocatedPct: residual, stats: computeStats(weights, ctx), ...extra,
    });
  };

  for (const m of input.assetClassMeta) {
    pushFromWeights("asset_class", m.id, m.name, [{ assetClassId: m.id, weight: 1 }], null, 0,
      { sortOrder: m.sortOrder, assetType: m.assetType });
  }

  for (const a of accounts) {
    const agg = aggregateWeights([{ value: a.value, result: resolver(a) }]);
    if (agg.weights.length === 0) {
      unplottable.push({ id: a.id, name: a.name, value: a.value, reason: "No asset-class mix" });
      continue;
    }
    pushFromWeights("account", a.id, a.name, agg.weights, agg.totalValue, agg.residualUnallocatedPct);
  }

  const byCategory = new Map<string, AnalysisAccount[]>();
  for (const a of accounts) (byCategory.get(a.category) ?? byCategory.set(a.category, []).get(a.category)!).push(a);
  for (const [category, accts] of byCategory) {
    const agg = aggregateWeights(accts.map((a) => ({ value: a.value, result: resolver(a) })));
    if (agg.weights.length === 0) continue;
    pushFromWeights("category", category, categoryLabel(category), agg.weights, agg.totalValue, agg.residualUnallocatedPct);
  }

  const acctById = new Map(accounts.map((a) => [a.id, a]));
  for (const g of input.customGroups) {
    const members = g.accountIds.map((id) => acctById.get(id)).filter((a): a is AnalysisAccount => !!a);
    if (members.length === 0) continue;
    const agg = aggregateWeights(members.map((a) => ({ value: a.value, result: resolver(a) })));
    if (agg.weights.length === 0) continue;
    pushFromWeights("custom_group", g.id, g.name, agg.weights, agg.totalValue, agg.residualUnallocatedPct);
  }

  for (const mp of input.modelPortfolios) {
    const weights = input.modelPortfolioAllocationsByPortfolioId[mp.id] ?? [];
    if (weights.length === 0) continue;
    pushFromWeights("model_portfolio", mp.id, mp.name, weights, null, 0);
  }

  return { rows, unplottable };
}

const CATEGORY_LABELS: Record<string, string> = {
  taxable: "Taxable", cash: "Cash", retirement: "Retirement",
  real_estate: "Real Estate", business: "Business",
  life_insurance: "Life Insurance", notes_receivable: "Notes Receivable",
};
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
