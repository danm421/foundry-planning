import type { AssetClassData } from "@/lib/portfolio-math";
import type { AssetClassWeight } from "./benchmarks";
import type { AccountAllocationResult } from "./allocation";
import type { AssetTypeId } from "./asset-types";
import type { RiskReturnStats, StatsContext } from "./portfolio-stats";
import {
  aggregateWeights,
  buildAnalysisRows,
  type AnalysisRow,
  type AnalysisAccount,
  type AssetClassMeta,
  type CustomGroupInput,
} from "./portfolio-analysis";

export interface AssetClassDetail {
  id: string;
  name: string;
  sortOrder: number;
  assetType: AssetTypeId;
  stats: RiskReturnStats;
  tax: { ordinaryIncome: number; ltCapitalGains: number; qualifiedDividends: number; taxExempt: number };
}

export interface AccountDetail {
  name: string;
  category: string;
  value: number;
  weights: AssetClassWeight[];
}

export interface PortfolioAnalysisDataset {
  rows: AnalysisRow[];
  assetClasses: AssetClassDetail[];
  accountsById: Record<string, AccountDetail>;
  categoryMembers: Record<string, string[]>;
  customGroups: { id: string; name: string }[];
  customGroupMembers: Record<string, string[]>;
}

export interface AssembleAnalysisInput {
  assetClassMeta: AssetClassMeta[];
  assetClassData: AssetClassData[];
  ctx: StatsContext;
  accounts: AnalysisAccount[];
  resolver: (acct: { id: string }) => AccountAllocationResult;
  modelPortfolios: { id: string; name: string }[];
  modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]>;
  customGroups: CustomGroupInput[];
}

export function assembleAnalysisDataset(input: AssembleAnalysisInput): PortfolioAnalysisDataset {
  const { rows } = buildAnalysisRows({
    assetClasses: input.assetClassData,
    assetClassMeta: input.assetClassMeta,
    accounts: input.accounts,
    resolver: input.resolver,
    modelPortfolios: input.modelPortfolios,
    modelPortfolioAllocationsByPortfolioId: input.modelPortfolioAllocationsByPortfolioId,
    customGroups: input.customGroups,
    ctx: input.ctx,
  });

  // Per-class stats come straight off the asset_class rows buildAnalysisRows
  // already emits (weight = 1 each), so the numbers can never diverge from the
  // scatter. Tax composition comes from the raw CMA data.
  const statsByClassId = new Map<string, RiskReturnStats>();
  for (const r of rows) if (r.type === "asset_class") statsByClassId.set(r.id, r.stats);
  const taxByClassId = new Map(input.assetClassData.map((c) => [c.id, c]));

  const assetClasses: AssetClassDetail[] = input.assetClassMeta.map((m) => {
    const tax = taxByClassId.get(m.id);
    return {
      id: m.id,
      name: m.name,
      sortOrder: m.sortOrder,
      assetType: m.assetType,
      stats: statsByClassId.get(m.id) ?? { arithmeticMean: 0, geometricReturn: 0, stdDev: 0, sharpe: null },
      tax: {
        ordinaryIncome: tax?.pctOrdinaryIncome ?? 0,
        ltCapitalGains: tax?.pctLtCapitalGains ?? 0,
        qualifiedDividends: tax?.pctQualifiedDividends ?? 0,
        taxExempt: tax?.pctTaxExempt ?? 0,
      },
    };
  });

  const accountsById: Record<string, AccountDetail> = {};
  const categoryMembers: Record<string, string[]> = {};
  for (const a of input.accounts) {
    const agg = aggregateWeights([{ value: a.value, result: input.resolver(a) }]);
    accountsById[a.id] = { name: a.name, category: a.category, value: a.value, weights: agg.weights };
    (categoryMembers[a.category] ??= []).push(a.id);
  }

  const customGroupMembers: Record<string, string[]> = {};
  for (const g of input.customGroups) customGroupMembers[g.id] = g.accountIds;

  return {
    rows,
    assetClasses,
    accountsById,
    categoryMembers,
    customGroups: input.customGroups.map((g) => ({ id: g.id, name: g.name })),
    customGroupMembers,
  };
}
