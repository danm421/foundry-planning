import { describe, it, expect } from "vitest";
import { resolveAccountFromRaw, type ResolutionContext } from "../resolve-entity";

// Minimal resolver stub. Holdings-driven accounts now resolve their blend
// through the normal asset_mix path (growthSource is forced to "asset_mix" by
// syncAccountFromHoldings); value/basis come from holdingsTotalsByAccountId.
const resolver = {
  getCategoryGrowthSource: () => "default",
  resolvePortfolio: () => ({ geoReturn: 0, pctOi: 0, pctLtcg: 0, pctQdiv: 0, pctTaxEx: 0 }),
  resolveAccountMix: () => ({ geoReturn: 0.07, pctOi: 0.1, pctLtcg: 0.6, pctQdiv: 0.3, pctTaxEx: 0 }),
  resolveCategoryDefault: () => ({ rate: 0.05 }),
} as unknown as ResolutionContext["resolver"];

const rawBase = {
  id: "acct1", name: "Brokerage", category: "taxable" as const, subType: "individual",
  value: "0", basis: "0", growthSource: "asset_mix", growthRate: null, turnoverPct: "0",
  annualPropertyTax: "0", propertyTaxGrowthRate: "0", rmdEnabled: false, isDefaultChecking: false,
  modelPortfolioId: null, tickerPortfolioId: null, overridePctOi: null, overridePctLtCg: null, overridePctQdiv: null,
  overridePctTaxExempt: null, priorYearEndValue: null, insuredPerson: null,
  titlingType: "jtwros" as const,
};

describe("resolveAccountFromRaw — holdings-driven (asset_mix)", () => {
  it("resolves growth + realization through the asset_mix path", () => {
    const ctx = { resolver, resolvedInflationRate: 0.025 } as ResolutionContext;
    const acct = resolveAccountFromRaw(rawBase, ctx);
    expect(acct.growthRate).toBeCloseTo(0.07, 6);
    expect(acct.realization?.pctLtCapitalGains).toBeCloseTo(0.6, 6);
  });

  it("overrides value + basis from the holdings totals when present", () => {
    const ctx = {
      resolver, resolvedInflationRate: 0.025,
      holdingsTotalsByAccountId: new Map([["acct1", { value: 12345, basis: 9000 }]]),
    } as ResolutionContext;
    const acct = resolveAccountFromRaw(rawBase, ctx);
    expect(acct.value).toBe(12345);
    expect(acct.basis).toBe(9000);
  });

  it("falls back to raw value when no totals entry exists", () => {
    const ctx = { resolver, resolvedInflationRate: 0.025 } as ResolutionContext;
    const acct = resolveAccountFromRaw({ ...rawBase, value: "777", basis: "500" }, ctx);
    expect(acct.value).toBe(777);
    expect(acct.basis).toBe(500);
  });

  // A retirement wrapper realizes no capital gains, so its holdings' cost
  // basis is tax-irrelevant. `basis` there means already-taxed Form 8606
  // dollars, which come back TAX-FREE pro-rata on every distribution — so
  // rolling holdings into it would hand an imported IRA a huge phantom
  // post-tax basis and untax most of what it pays out.
  it("takes VALUE but NOT basis from holdings on a retirement account", () => {
    const ctx = {
      resolver, resolvedInflationRate: 0.025,
      holdingsTotalsByAccountId: new Map([["acct1", { value: 500_000, basis: 380_000 }]]),
    } as ResolutionContext;
    const acct = resolveAccountFromRaw(
      { ...rawBase, category: "retirement" as const, subType: "traditional_ira", basis: "0" },
      ctx,
    );
    expect(acct.value).toBe(500_000);
    expect(acct.basis).toBe(0);
  });

  it("keeps the advisor's entered post-tax basis on a holdings-driven IRA", () => {
    const ctx = {
      resolver, resolvedInflationRate: 0.025,
      holdingsTotalsByAccountId: new Map([["acct1", { value: 500_000, basis: 380_000 }]]),
    } as ResolutionContext;
    const acct = resolveAccountFromRaw(
      { ...rawBase, category: "retirement" as const, subType: "traditional_ira", basis: "50000" },
      ctx,
    );
    expect(acct.basis).toBe(50_000);
  });
});
