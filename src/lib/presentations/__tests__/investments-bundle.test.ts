import { describe, it, expect } from "vitest";
import { buildInvestmentsResolver, bundleGroupDeps, type InvestmentsBundle } from "../investments-bundle";

function fixture(): InvestmentsBundle {
  return {
    clientId: "c1",
    firmId: "f1",
    accounts: [
      { id: "a1", name: "Brokerage", category: "taxable", growthSource: "asset_mix",
        modelPortfolioId: null, value: 100, ownerEntityId: null, entityInPortfolio: false },
      { id: "a2", name: "IRA", category: "retirement", growthSource: "model_portfolio",
        modelPortfolioId: "mp1", value: 50, ownerEntityId: null, entityInPortfolio: false },
    ],
    assetClassLites: [
      { id: "eq", name: "US Equity", sortOrder: 0, assetType: "equities" },
      { id: "bd", name: "Bonds", sortOrder: 1, assetType: "taxable_bonds" },
    ],
    assetClassData: [
      { id: "eq", arithmeticMean: 0.08, geometricReturn: 0.07, volatility: 0.16,
        pctOrdinaryIncome: 0, pctLtCapitalGains: 1, pctQualifiedDividends: 0, pctTaxExempt: 0 },
      { id: "bd", arithmeticMean: 0.03, geometricReturn: 0.029, volatility: 0.05,
        pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
    ],
    cashAssetClassId: null,
    riskFreeRate: 0.03,
    correlationRows: [{ assetClassIdA: "bd", assetClassIdB: "eq", correlation: 0.1 }],
    accountMixByAccountId: { a1: [{ assetClassId: "eq", weight: 1 }] },
    modelPortfolioAllocationsByPortfolioId: { mp1: [{ assetClassId: "bd", weight: 1 }] },
    planLite: {
      growthSourceTaxable: "asset_mix", growthSourceCash: "asset_mix", growthSourceRetirement: "model_portfolio",
      modelPortfolioIdTaxable: null, modelPortfolioIdCash: null, modelPortfolioIdRetirement: "mp1",
    },
    portfolioLites: [{ id: "mp1", name: "60/40" }],
    selectedBenchmarkPortfolioId: "mp1",
    customGroups: [{ id: "g1", name: "Kids", color: null, accountIds: ["a1"] }],
    resolvedGroups: {},
    groupOptions: [],
  };
}

describe("buildInvestmentsResolver", () => {
  it("resolves an asset_mix account to its stored weights", () => {
    const b = fixture();
    const resolver = buildInvestmentsResolver(b);
    const result = resolver({ id: "a1", category: "taxable", growthSource: "asset_mix", modelPortfolioId: null });
    expect(result).toEqual({ classified: [{ assetClassId: "eq", weight: 1 }] });
  });

  it("resolves a model_portfolio account to the portfolio's weights", () => {
    const b = fixture();
    const resolver = buildInvestmentsResolver(b);
    const result = resolver({ id: "a2", category: "retirement", growthSource: "model_portfolio", modelPortfolioId: "mp1" });
    expect(result).toEqual({ classified: [{ assetClassId: "bd", weight: 1 }] });
  });
});

describe("bundleGroupDeps", () => {
  it("exposes accounts and custom-group lookup from the bundle", async () => {
    const b = fixture();
    const deps = bundleGroupDeps(b);
    expect(await deps.fetchAccounts()).toEqual([
      { id: "a1", category: "taxable" },
      { id: "a2", category: "retirement" },
    ]);
    expect(await deps.fetchCustomGroup("c1", "g1")).toEqual({
      name: "Kids", color: null, memberAccountIds: ["a1"],
    });
    expect(await deps.fetchCustomGroup("c1", "missing")).toBeNull();
  });
});
