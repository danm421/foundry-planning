import { describe, it, expect } from "vitest";
import { buildAssetAllocationData } from "../view-model";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import type { ResolvedGroup } from "@/lib/account-groups/resolver";

function bundle(overrides: Partial<InvestmentsBundle> = {}): InvestmentsBundle {
  const resolved: ResolvedGroup = {
    groupKey: "all-liquid", groupName: "All Liquid Assets", groupColor: null,
    isDefault: true, accountIds: ["a1", "a2"],
  };
  return {
    clientId: "c1", firmId: "f1",
    accounts: [
      { id: "a1", name: "Brokerage", category: "taxable", growthSource: "asset_mix", modelPortfolioId: null, value: 75, ownerEntityId: null, entityInPortfolio: false },
      { id: "a2", name: "IRA", category: "retirement", growthSource: "asset_mix", modelPortfolioId: null, value: 25, ownerEntityId: null, entityInPortfolio: false },
    ],
    assetClassLites: [
      { id: "eq", name: "US Equity", sortOrder: 0, assetType: "equities" },
      { id: "bd", name: "Bonds", sortOrder: 1, assetType: "taxable_bonds" },
    ],
    assetClassData: [], cashAssetClassId: null, riskFreeRate: 0.03, correlationRows: [],
    accountMixByAccountId: { a1: [{ assetClassId: "eq", weight: 1 }], a2: [{ assetClassId: "bd", weight: 1 }] },
    modelPortfolioAllocationsByPortfolioId: { mp1: [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }] },
    planLite: { growthSourceTaxable: "asset_mix", growthSourceCash: "asset_mix", growthSourceRetirement: "asset_mix", modelPortfolioIdTaxable: null, modelPortfolioIdCash: null, modelPortfolioIdRetirement: null },
    portfolioLites: [{ id: "mp1", name: "60/40" }],
    selectedBenchmarkPortfolioId: null,
    customGroups: [],
    resolvedGroups: { "all-liquid": resolved, taxable: { ...resolved, groupKey: "taxable", groupName: "Taxable", accountIds: ["a1"] } },
    groupOptions: [{ key: "all-liquid", name: "All Liquid Assets" }],
    ...overrides,
  };
}

describe("buildAssetAllocationData", () => {
  it("builds donut + table with no benchmark", () => {
    const data = buildAssetAllocationData(bundle(), { groupKey: "all-liquid", view: "detailed", includeOutOfEstate: false, showTable: true });
    expect(data.subtitle).toBe("All Liquid Assets");
    expect(data.currentDonut.rings).toHaveLength(1);
    expect(data.benchmarkDonut).toBeNull();
    expect(data.driftRows).toBeNull();
    expect(data.tableRows.length).toBeGreaterThan(0);
  });
  it("adds a benchmark donut + drift when a benchmark is configured on a default non-all-liquid group", () => {
    const data = buildAssetAllocationData(
      bundle({ selectedBenchmarkPortfolioId: "mp1" }),
      { groupKey: "taxable", view: "detailed", includeOutOfEstate: false, showTable: true },
    );
    expect(data.benchmarkDonut).not.toBeNull();
    expect(data.driftRows).not.toBeNull();
  });
  it("falls back to all-liquid when the group key is unknown", () => {
    const data = buildAssetAllocationData(bundle(), { groupKey: "deleted-uuid", view: "detailed", includeOutOfEstate: false, showTable: true });
    expect(data.subtitle).toBe("All Liquid Assets");
  });
  it("returns empty tableRows when showTable is false", () => {
    const data = buildAssetAllocationData(bundle(), { groupKey: "all-liquid", view: "detailed", includeOutOfEstate: false, showTable: false });
    expect(data.tableRows).toHaveLength(0);
  });
});
