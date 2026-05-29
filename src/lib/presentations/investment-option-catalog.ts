import { buildStatsContext } from "@/lib/investments/portfolio-stats";
import { buildAnalysisRows } from "@/lib/investments/portfolio-analysis";
import { buildInvestmentsResolver, loadInvestmentsBundle } from "./investments-bundle";

export interface InvestmentEntityOption { key: string; type: string; name: string; }
export interface InvestmentOptionCatalog {
  groups: { key: string; name: string }[];
  entities: InvestmentEntityOption[];
}

/** Fallback catalog when no investment data is available (also the context default). */
export const EMPTY_INVESTMENT_OPTION_CATALOG: InvestmentOptionCatalog = {
  groups: [{ key: "all-liquid", name: "All Liquid Assets" }],
  entities: [],
};

/** Builder-UI catalog: selectable account groups + plottable analysis entities. */
export async function listInvestmentOptionCatalog(
  clientId: string, firmId: string,
): Promise<InvestmentOptionCatalog> {
  const bundle = await loadInvestmentsBundle(clientId, firmId);
  if (!bundle) return EMPTY_INVESTMENT_OPTION_CATALOG;
  const ctx = buildStatsContext(bundle.assetClassData, bundle.correlationRows, bundle.riskFreeRate);
  const resolver = buildInvestmentsResolver(bundle);
  const { rows } = buildAnalysisRows({
    assetClasses: bundle.assetClassData,
    assetClassMeta: bundle.assetClassLites,
    accounts: bundle.accounts.map((a) => ({
      id: a.id, name: a.name, category: a.category, value: a.value,
      growthSource: a.growthSource, modelPortfolioId: a.modelPortfolioId,
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
  return {
    groups: bundle.groupOptions,
    entities: rows.map((r) => ({ key: r.key, type: r.type, name: r.name })),
  };
}
