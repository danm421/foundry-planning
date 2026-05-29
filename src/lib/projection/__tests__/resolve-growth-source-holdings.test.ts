import { describe, it, expect } from "vitest";
import { createGrowthSourceResolver } from "../resolve-growth-source";

const ASSET_CLASSES = [
  { id: "ac-large", geometricReturn: "0.10", pctOrdinaryIncome: "0.1", pctLtCapitalGains: "0.6", pctQualifiedDividends: "0.3", pctTaxExempt: "0" },
  { id: "ac-bond",  geometricReturn: "0.04", pctOrdinaryIncome: "1.0", pctLtCapitalGains: "0",   pctQualifiedDividends: "0",   pctTaxExempt: "0" },
  { id: "ac-infl",  geometricReturn: "0.025", pctOrdinaryIncome: "0",  pctLtCapitalGains: "0",   pctQualifiedDividends: "0",   pctTaxExempt: "0" },
];

const BASE = {
  planSettings: {
    growthSourceTaxable: "default", growthSourceCash: "default", growthSourceRetirement: "default",
    growthSourceRealEstate: "default", growthSourceBusiness: "default", growthSourceLifeInsurance: "default",
    modelPortfolioIdTaxable: null, modelPortfolioIdCash: null, modelPortfolioIdRetirement: null,
    defaultGrowthTaxable: "0.05", defaultGrowthCash: "0.01", defaultGrowthRetirement: "0.05",
    defaultGrowthRealEstate: "0.03", defaultGrowthBusiness: "0.05", defaultGrowthLifeInsurance: "0.04",
    inflationAssetClassId: "ac-infl",
  },
  assetClasses: ASSET_CLASSES,
  modelPortfolios: [],
  modelPortfolioAllocations: [],
  accountAssetAllocations: [],
  clientCmaOverrides: [],
};

describe("resolveAccountHoldings", () => {
  it("folds a holdings allocation identically to an equivalent asset_mix", () => {
    const allocs = [
      { accountId: "acct1", assetClassId: "ac-large", weight: "0.6" },
      { accountId: "acct1", assetClassId: "ac-bond", weight: "0.4" },
    ];
    const viaMix = createGrowthSourceResolver({ ...BASE, accountAssetAllocations: allocs }).resolveAccountMix("acct1");
    const viaHoldings = createGrowthSourceResolver({ ...BASE, accountHoldingsAllocations: allocs }).resolveAccountHoldings("acct1");
    expect(viaHoldings).toEqual(viaMix);
  });

  it("routes residual weight to the inflation fallback", () => {
    const r = createGrowthSourceResolver({
      ...BASE,
      accountHoldingsAllocations: [{ accountId: "acct1", assetClassId: "ac-large", weight: "0.5" }],
    });
    const out = r.resolveAccountHoldings("acct1");
    // 0.5 large (0.10) + 0.5 residual → inflation (0.025) = 0.0625
    expect(out.geoReturn).toBeCloseTo(0.0625, 6);
  });

  it("holdingsAllocMap returns the folded fractional map", () => {
    const r = createGrowthSourceResolver({
      ...BASE,
      accountHoldingsAllocations: [
        { accountId: "acct1", assetClassId: "ac-large", weight: "0.6" },
        { accountId: "acct1", assetClassId: "ac-bond", weight: "0.4" },
      ],
    });
    expect(r.holdingsAllocMap("acct1")).toEqual(new Map([["ac-large", 0.6], ["ac-bond", 0.4]]));
    expect(r.holdingsAllocMap("nope")).toBeUndefined();
  });
});
