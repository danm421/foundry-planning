import { buildStatsContext } from "@/lib/investments/portfolio-stats";
import { buildAnalysisRows, type AnalysisRow, type UnplottableAccount } from "@/lib/investments/portfolio-analysis";
import { buildInvestmentsResolver, type InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import { buildScatterSpec } from "@/lib/presentations/charts/scatter-chart-spec";
import type { ScatterSpec } from "@/lib/presentations/charts/types";
import { defaultAnalysisSelection } from "./default-selection";
import type { PortfolioAnalysisOptions } from "./options-schema";

export interface AnalysisTableRow {
  key: string; name: string; type: AnalysisRow["type"];
  geometricReturn: number; arithmeticMean: number; stdDev: number;
  sharpe: number | null; value: number | null;
}
export interface PortfolioAnalysisData {
  scatter: ScatterSpec;
  tableRows: AnalysisTableRow[];
  unplottable: UnplottableAccount[];
}

function numericSortValue(r: AnalysisRow, key: Exclude<PortfolioAnalysisOptions["sortKey"], "name">): number {
  switch (key) {
    case "return": return r.stats.geometricReturn;
    case "mean": return r.stats.arithmeticMean;
    case "stdDev": return r.stats.stdDev;
    case "sharpe": return r.stats.sharpe ?? -Infinity;
    case "value": return r.value ?? -Infinity;
  }
}

export function buildPortfolioAnalysisData(
  bundle: InvestmentsBundle, options: PortfolioAnalysisOptions,
): PortfolioAnalysisData {
  const ctx = buildStatsContext(bundle.assetClassData, bundle.correlationRows, bundle.riskFreeRate);
  const resolver = buildInvestmentsResolver(bundle);
  const { rows, unplottable } = buildAnalysisRows({
    assetClasses: bundle.assetClassData,
    assetClassMeta: bundle.assetClassLites,
    accounts: bundle.accounts.map((a) => ({
      id: a.id, name: a.name, category: a.category, value: a.value,
      growthSource: a.growthSource, modelPortfolioId: a.modelPortfolioId,
      tickerPortfolioId: a.tickerPortfolioId,
    })),
    // AnalysisAccount carries all fields the resolver reads at runtime; this cast
    // aligns its declared parameter type with BuildAnalysisInput's looser { id }
    // signature.
    resolver: resolver as (acct: { id: string }) => ReturnType<typeof resolver>,
    modelPortfolios: bundle.portfolioLites,
    modelPortfolioAllocationsByPortfolioId: bundle.modelPortfolioAllocationsByPortfolioId,
    customGroups: bundle.customGroups,
    ctx,
  });

  const selected = options.selectedKeys.length > 0
    ? new Set(options.selectedKeys)
    : new Set(defaultAnalysisSelection(rows));
  const visible = rows.filter((r) => selected.has(r.key));

  const dir = options.sortDir === "asc" ? 1 : -1;
  visible.sort((a, b) => {
    if (options.sortKey === "name") {
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
    }
    return (numericSortValue(a, options.sortKey) - numericSortValue(b, options.sortKey)) * dir;
  });

  return {
    scatter: buildScatterSpec(visible),
    tableRows: visible.map((r) => ({
      key: r.key, name: r.name, type: r.type,
      geometricReturn: r.stats.geometricReturn, arithmeticMean: r.stats.arithmeticMean,
      stdDev: r.stats.stdDev, sharpe: r.stats.sharpe, value: r.value,
    })),
    unplottable,
  };
}
