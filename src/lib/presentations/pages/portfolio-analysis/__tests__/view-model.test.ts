import { describe, it, expect } from "vitest";
import { buildPortfolioAnalysisData } from "../view-model";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";

function bundle(): InvestmentsBundle {
  return {
    clientId: "c1", firmId: "f1",
    accounts: [
      { id: "a1", name: "Brokerage", category: "taxable", growthSource: "asset_mix", modelPortfolioId: null, value: 100, ownerEntityId: null, entityInPortfolio: false },
    ],
    assetClassLites: [
      { id: "eq", name: "US Equity", sortOrder: 0, assetType: "equities" },
      { id: "bd", name: "Bonds", sortOrder: 1, assetType: "taxable_bonds" },
    ],
    assetClassData: [
      { id: "eq", arithmeticMean: 0.08, geometricReturn: 0.07, volatility: 0.16, pctOrdinaryIncome: 0, pctLtCapitalGains: 1, pctQualifiedDividends: 0, pctTaxExempt: 0 },
      { id: "bd", arithmeticMean: 0.03, geometricReturn: 0.029, volatility: 0.05, pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
    ],
    cashAssetClassId: null, riskFreeRate: 0.03,
    correlationRows: [{ assetClassIdA: "bd", assetClassIdB: "eq", correlation: 0.1 }],
    accountMixByAccountId: { a1: [{ assetClassId: "eq", weight: 1 }] },
    modelPortfolioAllocationsByPortfolioId: {},
    planLite: { growthSourceTaxable: "asset_mix", growthSourceCash: "asset_mix", growthSourceRetirement: "asset_mix", modelPortfolioIdTaxable: null, modelPortfolioIdCash: null, modelPortfolioIdRetirement: null },
    portfolioLites: [], selectedBenchmarkPortfolioId: null, customGroups: [],
    resolvedGroups: {}, groupOptions: [],
  };
}

describe("buildPortfolioAnalysisData", () => {
  it("falls back to default selection when selectedKeys is empty", () => {
    const data = buildPortfolioAnalysisData(bundle(), { selectedKeys: [], sortKey: "stdDev", sortDir: "asc" });
    expect(data.tableRows.some((r) => r.key === "asset_class:eq")).toBe(true);
    expect(data.scatter.points.length).toBe(data.tableRows.length);
  });
  it("filters to selectedKeys and sorts ascending by stdDev", () => {
    const data = buildPortfolioAnalysisData(bundle(), { selectedKeys: ["asset_class:eq", "asset_class:bd"], sortKey: "stdDev", sortDir: "asc" });
    expect(data.tableRows.map((r) => r.key)).toEqual(["asset_class:bd", "asset_class:eq"]);
  });
});
