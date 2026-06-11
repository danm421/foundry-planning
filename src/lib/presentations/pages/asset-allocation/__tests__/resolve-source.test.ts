import { describe, it, expect } from "vitest";
import { portfolioToNormalized, resolveAllocationSource } from "../resolve-source";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import type { ResolvedGroup } from "@/lib/account-groups/resolver";
import type { AssetAllocationOptions } from "../options-schema";

const LITES = [
  { id: "eq", name: "US Equity", sortOrder: 0, assetType: "equities" as const },
  { id: "bd", name: "Bonds", sortOrder: 1, assetType: "taxable_bonds" as const },
];

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
    assetClassLites: LITES,
    assetClassData: [], cashAssetClassId: null, riskFreeRate: 0.03, correlationRows: [],
    accountMixByAccountId: { a1: [{ assetClassId: "eq", weight: 1 }], a2: [{ assetClassId: "bd", weight: 1 }] },
    modelPortfolioAllocationsByPortfolioId: { mp1: [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }] },
    tickerPortfolioAllocationsByPortfolioId: {},
    planLite: { growthSourceTaxable: "asset_mix", growthSourceCash: "asset_mix", growthSourceRetirement: "asset_mix", modelPortfolioIdTaxable: null, modelPortfolioIdCash: null, modelPortfolioIdRetirement: null },
    portfolioLites: [{ id: "mp1", name: "60/40" }],
    selectedBenchmarkPortfolioId: null,
    customGroups: [],
    resolvedGroups: { "all-liquid": resolved },
    groupOptions: [{ key: "all-liquid", name: "All Liquid Assets" }],
    ...overrides,
  };
}
const OPTS: AssetAllocationOptions = {
  left: { kind: "group", id: "all-liquid" }, right: null,
  view: "detailed", includeOutOfEstate: false, showTable: true, showExcluded: true,
};

describe("portfolioToNormalized", () => {
  it("maps weights to classes and rolls up asset types", () => {
    const n = portfolioToNormalized("60/40", [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }], LITES);
    expect(n.displayName).toBe("60/40");
    expect(n.byAssetClass.map((c) => c.id)).toEqual(["eq", "bd"]);
    expect(n.byAssetType.map((t) => t.id)).toEqual(["equities", "taxable_bonds"]);
    expect(n.unallocatedValue).toBe(0);
    expect(n.excludedNonInvestableValue).toBe(0);
  });
});

describe("resolveAllocationSource", () => {
  it("resolves a group to its household allocation", () => {
    const n = resolveAllocationSource(bundle(), { kind: "group", id: "all-liquid" }, OPTS);
    expect(n?.displayName).toBe("All Liquid Assets");
    expect(n?.byAssetClass.length).toBeGreaterThan(0);
  });
  it("resolves a portfolio source by id", () => {
    const n = resolveAllocationSource(bundle(), { kind: "portfolio", id: "mp1" }, OPTS);
    expect(n?.displayName).toBe("60/40");
  });
  it("resolves recommended to the plan benchmark when set", () => {
    const n = resolveAllocationSource(bundle({ selectedBenchmarkPortfolioId: "mp1" }), { kind: "recommended" }, OPTS);
    expect(n?.displayName).toBe("60/40");
  });
  it("returns null for recommended when no benchmark is set", () => {
    expect(resolveAllocationSource(bundle(), { kind: "recommended" }, OPTS)).toBeNull();
  });
  it("returns null for a null ref", () => {
    expect(resolveAllocationSource(bundle(), null, OPTS)).toBeNull();
  });
});
