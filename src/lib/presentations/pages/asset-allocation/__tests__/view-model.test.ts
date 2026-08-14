import { describe, it, expect } from "vitest";
import { buildAssetAllocationData } from "../view-model";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import type { ResolvedGroup } from "@/lib/account-groups/resolver";
import type { AssetAllocationOptions } from "../options-schema";

function bundle(overrides: Partial<InvestmentsBundle> = {}): InvestmentsBundle {
  const resolved: ResolvedGroup = {
    groupKey: "all-liquid", groupName: "All Liquid Assets", groupColor: null,
    isDefault: true, accountIds: ["a1", "a2"],
  };
  return {
    clientId: "c1", firmId: "f1",
    accounts: [
      { id: "a1", name: "Brokerage", category: "taxable", growthSource: "asset_mix", modelPortfolioId: null, tickerPortfolioId: null, value: 75, ownerEntityId: null, entityInPortfolio: false },
      { id: "a2", name: "IRA", category: "retirement", growthSource: "asset_mix", modelPortfolioId: null, tickerPortfolioId: null, value: 25, ownerEntityId: null, entityInPortfolio: false },
    ],
    assetClassLites: [
      { id: "eq", name: "US Equity", sortOrder: 0, assetType: "equities" },
      { id: "bd", name: "Bonds", sortOrder: 1, assetType: "taxable_bonds" },
    ],
    // Equity 8% / bonds 4% geometric — round numbers so a blend is checkable by hand.
    assetClassData: [
      { id: "eq", arithmeticMean: 0.09, geometricReturn: 0.08, volatility: 0.16, pctOrdinaryIncome: 0, pctLtCapitalGains: 1, pctQualifiedDividends: 0, pctTaxExempt: 0 },
      { id: "bd", arithmeticMean: 0.04, geometricReturn: 0.04, volatility: 0.05, pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
    ],
    cashAssetClassId: null, riskFreeRate: 0.03, correlationRows: [],
    accountMixByAccountId: { a1: [{ assetClassId: "eq", weight: 1 }], a2: [{ assetClassId: "bd", weight: 1 }] },
    modelPortfolioAllocationsByPortfolioId: { mp1: [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }] },
    tickerPortfolioAllocationsByPortfolioId: {},
    planLite: { growthSourceTaxable: "asset_mix", growthSourceCash: "asset_mix", growthSourceRetirement: "asset_mix", modelPortfolioIdTaxable: null, modelPortfolioIdCash: null, modelPortfolioIdRetirement: null },
    portfolioLites: [{ id: "mp1", name: "60/40" }],
    selectedBenchmarkPortfolioId: null,
    customGroups: [],
    resolvedGroups: { "all-liquid": resolved, taxable: { ...resolved, groupKey: "taxable", groupName: "Taxable", accountIds: ["a1"] } },
    groupOptions: [{ key: "all-liquid", name: "All Liquid Assets" }],
    ...overrides,
  };
}
function opts(o: Partial<AssetAllocationOptions> = {}): AssetAllocationOptions {
  return { left: { kind: "group", id: "all-liquid" }, right: null, view: "detailed", includeOutOfEstate: false, showTable: true, showExcluded: true, showReturn: false, ...o };
}

// An investable account whose growth_source resolves to no asset mix ("custom"
// here) is excluded from the donut and itemized in excludedRows.
const excludedBundle = () =>
  bundle({
    accounts: [
      { id: "a1", name: "Brokerage", category: "taxable", growthSource: "asset_mix", modelPortfolioId: null, tickerPortfolioId: null, value: 75, ownerEntityId: null, entityInPortfolio: false },
      { id: "a3", name: "Old 401(k)", category: "retirement", growthSource: "custom", modelPortfolioId: null, tickerPortfolioId: null, value: 50, ownerEntityId: null, entityInPortfolio: false },
    ],
    resolvedGroups: {
      "all-liquid": { groupKey: "all-liquid", groupName: "All Liquid Assets", groupColor: null, isDefault: true, accountIds: ["a1", "a3"] },
    },
  });

describe("buildAssetAllocationData", () => {
  it("single donut when right is null", () => {
    const data = buildAssetAllocationData(bundle(), opts());
    expect(data.subtitle).toBe("All Liquid Assets");
    expect(data.leftName).toBe("All Liquid Assets");
    expect(data.rightName).toBeNull();
    expect(data.rightDonut).toBeNull();
    expect(data.diffRows).toBeNull();
    expect(data.tableRows.length).toBeGreaterThan(0);
    expect(data.tableRows[0]!.rightPct).toBe(0);
  });
  it("compares a group against the recommended portfolio", () => {
    const data = buildAssetAllocationData(
      bundle({ selectedBenchmarkPortfolioId: "mp1" }),
      opts({ left: { kind: "group", id: "all-liquid" }, right: { kind: "recommended" } }),
    );
    expect(data.rightDonut).not.toBeNull();
    expect(data.rightName).toBe("60/40");
    expect(data.subtitle).toBe("All Liquid Assets vs 60/40");
    expect(data.diffRows).not.toBeNull();
    expect(data.diffRows!.length).toBeGreaterThan(0);
  });
  it("compares a portfolio (left) against a group (right)", () => {
    const data = buildAssetAllocationData(
      bundle(),
      opts({ left: { kind: "portfolio", id: "mp1" }, right: { kind: "group", id: "taxable" } }),
    );
    expect(data.leftName).toBe("60/40");
    expect(data.rightName).toBe("Taxable");
    expect(data.rightDonut).not.toBeNull();
  });
  it("drops the right side when recommended is unset", () => {
    const data = buildAssetAllocationData(bundle(), opts({ right: { kind: "recommended" } }));
    expect(data.rightDonut).toBeNull();
    expect(data.rightName).toBeNull();
  });
  it("falls back to all-liquid for an unknown left group", () => {
    const data = buildAssetAllocationData(bundle(), opts({ left: { kind: "group", id: "deleted-uuid" } }));
    expect(data.leftName).toBe("All Liquid Assets");
  });
  it("returns empty tableRows when showTable is false", () => {
    const data = buildAssetAllocationData(bundle(), opts({ showTable: false }));
    expect(data.tableRows).toHaveLength(0);
  });

  it("itemizes investable accounts without an asset mix as excludedRows", () => {
    const data = buildAssetAllocationData(excludedBundle(), opts());
    expect(data.excludedRows).toEqual([{ id: "a3", name: "Old 401(k)", value: 50 }]);
    expect(data.excludedTotal).toBe(50);
  });

  it("omits excludedRows when showExcluded is false", () => {
    const data = buildAssetAllocationData(excludedBundle(), opts({ showExcluded: false }));
    expect(data.excludedRows).toHaveLength(0);
    expect(data.excludedTotal).toBe(0);
  });

  it("has no excludedRows for a fully allocated household", () => {
    const data = buildAssetAllocationData(bundle(), opts());
    expect(data.excludedRows).toHaveLength(0);
  });
});

describe("blended return", () => {
  it("is null on both sides when showReturn is off", () => {
    const data = buildAssetAllocationData(
      bundle({ selectedBenchmarkPortfolioId: "mp1" }),
      opts({ right: { kind: "recommended" } }),
    );
    expect(data.leftReturn).toBeNull();
    expect(data.rightReturn).toBeNull();
    expect(data.disclosure).not.toContain("Blended return");
  });

  it("value-weights a group across its accounts", () => {
    // $75 all-equity (8%) + $25 all-bond (4%) → 0.75(.08) + 0.25(.04) = 7%.
    const data = buildAssetAllocationData(bundle(), opts({ showReturn: true }));
    expect(data.leftReturn).toBeCloseTo(0.07, 10);
    expect(data.rightReturn).toBeNull();
  });

  it("blends a model portfolio from its own weights", () => {
    // 60/40 → 0.6(.08) + 0.4(.04) = 6.4%.
    const data = buildAssetAllocationData(
      bundle({ selectedBenchmarkPortfolioId: "mp1" }),
      opts({ showReturn: true, right: { kind: "recommended" } }),
    );
    expect(data.leftReturn).toBeCloseTo(0.07, 10);
    expect(data.rightReturn).toBeCloseTo(0.064, 10);
  });

  it("weights over classified dollars, so an unallocated account cannot drag it down", () => {
    // $75 all-equity + a $50 account with no asset mix → 8%, not 8% × 75/125.
    const data = buildAssetAllocationData(excludedBundle(), opts({ showReturn: true }));
    expect(data.leftReturn).toBeCloseTo(0.08, 10);
  });

  it("is null rather than a confident 0.0% when no assumptions exist", () => {
    const data = buildAssetAllocationData(bundle({ assetClassData: [] }), opts({ showReturn: true }));
    expect(data.leftReturn).toBeNull();
    expect(data.disclosure).not.toContain("Blended return");
  });

  it("adds the assumption disclosure once a return is shown", () => {
    const data = buildAssetAllocationData(bundle(), opts({ showReturn: true }));
    expect(data.disclosure).toContain("Investable assets only.");
    expect(data.disclosure).toContain("not a guarantee");
  });
});
