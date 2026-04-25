import { describe, it, expect } from "vitest";
import { createGrowthSourceResolver } from "../resolve-growth-source";

const assetClasses = [
  {
    id: "us-eq",
    geometricReturn: "0.07",
    pctOrdinaryIncome: "0.0",
    pctLtCapitalGains: "0.8",
    pctQualifiedDividends: "0.2",
    pctTaxExempt: "0.0",
  },
  {
    id: "bond",
    geometricReturn: "0.03",
    pctOrdinaryIncome: "1.0",
    pctLtCapitalGains: "0.0",
    pctQualifiedDividends: "0.0",
    pctTaxExempt: "0.0",
  },
  {
    id: "inflation",
    geometricReturn: "0.025",
    pctOrdinaryIncome: "0",
    pctLtCapitalGains: "0",
    pctQualifiedDividends: "0",
    pctTaxExempt: "0",
  },
] as const;

const planSettings = {
  growthSourceTaxable: "model_portfolio",
  modelPortfolioIdTaxable: "p-60-40",
  defaultGrowthTaxable: "0.05",
  growthSourceCash: "inflation",
  modelPortfolioIdCash: null,
  defaultGrowthCash: "0.02",
  growthSourceRetirement: "category_default",
  modelPortfolioIdRetirement: null,
  defaultGrowthRetirement: "0.06",
  defaultGrowthRealEstate: "0.04",
  defaultGrowthBusiness: "0.08",
  defaultGrowthLifeInsurance: "0.03",
  inflationAssetClassId: "inflation",
} as unknown as Parameters<typeof createGrowthSourceResolver>[0]["planSettings"];

const modelPortfolios = [{ id: "p-60-40" }];
const modelPortfolioAllocations = [
  { portfolioId: "p-60-40", assetClassId: "us-eq", weight: "0.6" },
  { portfolioId: "p-60-40", assetClassId: "bond", weight: "0.4" },
];

describe("createGrowthSourceResolver", () => {
  it("resolvePortfolio blends geometric return and realization splits by weight", () => {
    const r = createGrowthSourceResolver({
      planSettings,
      assetClasses,
      modelPortfolios,
      modelPortfolioAllocations,
      accountAssetAllocations: [],
      clientCmaOverrides: [],
    });
    const p = r.resolvePortfolio("p-60-40");
    // 0.6*0.07 + 0.4*0.03 = 0.054
    expect(p.geoReturn).toBeCloseTo(0.054, 6);
    // OI: 0.6*0 + 0.4*1 = 0.4
    expect(p.pctOi).toBeCloseTo(0.4, 6);
    // LTCG: 0.6*0.8 + 0.4*0 = 0.48
    expect(p.pctLtcg).toBeCloseTo(0.48, 6);
  });

  it("resolveAccountMix fills missing-weight residual with inflation fallback", () => {
    const r = createGrowthSourceResolver({
      planSettings,
      assetClasses,
      modelPortfolios: [],
      modelPortfolioAllocations: [],
      accountAssetAllocations: [
        { accountId: "a1", assetClassId: "us-eq", weight: "0.5" },
        // 0.5 residual → should blend with inflation (0.025)
      ],
      clientCmaOverrides: [],
    });
    const m = r.resolveAccountMix("a1");
    // 0.5*0.07 + 0.5*0.025 = 0.0475
    expect(m.geoReturn).toBeCloseTo(0.0475, 6);
  });

  it("resolveCategoryDefault dispatches on plan-settings source per category", () => {
    const r = createGrowthSourceResolver({
      planSettings,
      assetClasses,
      modelPortfolios,
      modelPortfolioAllocations,
      accountAssetAllocations: [],
      clientCmaOverrides: [],
    });
    // taxable → model_portfolio(p-60-40) → 0.054
    expect(r.resolveCategoryDefault("taxable").rate).toBeCloseTo(0.054, 6);
    // cash → inflation → resolveInflation() = 0.025
    expect(r.resolveCategoryDefault("cash").rate).toBeCloseTo(0.025, 6);
    // retirement → category_default (flat) → 0.06
    expect(r.resolveCategoryDefault("retirement").rate).toBeCloseTo(0.06, 6);
    // real_estate → flat 0.04 (no plan-settings source field for non-big-three)
    expect(r.resolveCategoryDefault("real_estate").rate).toBeCloseTo(0.04, 6);
  });

  it("resolveInflation prefers CMA override when present", () => {
    const r = createGrowthSourceResolver({
      planSettings,
      assetClasses,
      modelPortfolios: [],
      modelPortfolioAllocations: [],
      accountAssetAllocations: [],
      clientCmaOverrides: [
        { assetClassId: "inflation", geometricReturn: "0.035" },
      ],
    });
    expect(r.resolveInflation()).toBeCloseTo(0.035, 6);
  });
});
