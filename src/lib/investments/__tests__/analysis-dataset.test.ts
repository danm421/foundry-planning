import { describe, it, expect } from "vitest";
import { assembleAnalysisDataset } from "../analysis-dataset";
import { buildStatsContext } from "../portfolio-stats";
import type { AccountAllocationResult } from "../allocation";

// Two classes: equity (high vol), cash (zero vol). ρ defaults to 0.
const EQ = "eq", CASH = "cash";
const assetClassData = [
  { id: EQ, geometricReturn: 0.06, arithmeticMean: 0.08, volatility: 0.16,
    pctOrdinaryIncome: 0.1, pctLtCapitalGains: 0.7, pctQualifiedDividends: 0.2, pctTaxExempt: 0 },
  { id: CASH, geometricReturn: 0.02, arithmeticMean: 0.02, volatility: 0,
    pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
];
const assetClassMeta = [
  { id: EQ, name: "US Equity", sortOrder: 0, assetType: "equities" as const },
  { id: CASH, name: "Cash", sortOrder: 1, assetType: "cash" as const },
];
const ctx = buildStatsContext(assetClassData, [], 0.02);

// One account: 50/50 eq/cash, in the "retirement" category.
const accounts = [
  { id: "a1", name: "401k", category: "retirement", value: 1000,
    growthSource: "asset_mix", modelPortfolioId: null, tickerPortfolioId: null },
];
const resolver = (): AccountAllocationResult => ({
  classified: [{ assetClassId: EQ, weight: 0.5 }, { assetClassId: CASH, weight: 0.5 }],
});

function build() {
  return assembleAnalysisDataset({
    assetClassMeta, assetClassData, ctx, accounts, resolver,
    modelPortfolios: [], modelPortfolioAllocationsByPortfolioId: {},
    customGroups: [{ id: "g1", name: "My Group", color: null, accountIds: ["a1"] }],
  });
}

describe("assembleAnalysisDataset", () => {
  it("emits asset_class, account, category, and custom_group rows", () => {
    const ds = build();
    const types = new Set(ds.rows.map((r) => r.type));
    expect(types).toEqual(new Set(["asset_class", "account", "category", "custom_group"]));
  });

  it("exposes per-class stats and tax on assetClasses", () => {
    const ds = build();
    const eq = ds.assetClasses.find((c) => c.id === EQ)!;
    expect(eq.name).toBe("US Equity");
    expect(eq.stats.arithmeticMean).toBeCloseTo(0.08, 5);
    expect(eq.stats.stdDev).toBeCloseTo(0.16, 5);
    expect(eq.tax).toEqual({ ordinaryIncome: 0.1, ltCapitalGains: 0.7, qualifiedDividends: 0.2, taxExempt: 0 });
  });

  it("derives per-account normalized weights", () => {
    const ds = build();
    expect(ds.accountsById["a1"]).toBeTruthy();
    expect(ds.accountsById["a1"].value).toBe(1000);
    const w = Object.fromEntries(ds.accountsById["a1"].weights.map((x) => [x.assetClassId, x.weight]));
    expect(w[EQ]).toBeCloseTo(0.5, 5);
    expect(w[CASH]).toBeCloseTo(0.5, 5);
  });

  it("maps category and custom-group membership", () => {
    const ds = build();
    expect(ds.categoryMembers["retirement"]).toEqual(["a1"]);
    expect(ds.customGroupMembers["g1"]).toEqual(["a1"]);
    expect(ds.customGroups).toEqual([{ id: "g1", name: "My Group" }]);
  });
});
