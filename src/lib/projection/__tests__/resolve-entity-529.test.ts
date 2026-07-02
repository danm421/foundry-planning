import { describe, it, expect } from "vitest";
import { resolveAccountFromRaw, type ResolutionContext } from "../resolve-entity";
import { createGrowthSourceResolver } from "../resolve-growth-source";
import { EDUCATION_529_SENTINEL_OWNER_ID } from "@/engine/ownership";

// Copied verbatim (minus overrides we don't need) from resolve-entity.test.ts's
// makeCtx factory — the minimal ResolutionContext used across this directory.
function makeCtx(): ResolutionContext {
  const resolver = createGrowthSourceResolver({
    planSettings: {
      growthSourceTaxable: "default",
      growthSourceCash: "default",
      growthSourceRetirement: "default",
      growthSourceRealEstate: "default",
      growthSourceBusiness: "default",
      growthSourceLifeInsurance: "default",
      modelPortfolioIdTaxable: null,
      modelPortfolioIdCash: null,
      modelPortfolioIdRetirement: null,
      defaultGrowthTaxable: "0.07",
      defaultGrowthCash: "0.02",
      defaultGrowthRetirement: "0.06",
      defaultGrowthRealEstate: "0.04",
      defaultGrowthBusiness: "0.05",
      defaultGrowthLifeInsurance: "0.03",
      inflationAssetClassId: null,
    },
    assetClasses: [],
    modelPortfolios: [],
    modelPortfolioAllocations: [],
    accountAssetAllocations: [],
    clientCmaOverrides: [],
    tickerPortfolioAllocations: [],
  });
  return {
    resolver,
    resolvedInflationRate: 0.025,
    beneficiariesByAccountId: new Map(),
    policiesByAccount: {},
    ownersByAccountId: new Map(),
  };
}

const ctx = makeCtx();

describe("resolveAccountFromRaw — education_savings", () => {
  it("synthesizes the sentinel external_beneficiary owner and no realization", () => {
    const acct = resolveAccountFromRaw(
      {
        id: "a-529",
        name: "Emma 529",
        category: "education_savings",
        subType: "529",
        value: 50_000,
        basis: 50_000,
        growthRate: null,
        growthSource: "default",
        grantorFamilyMemberId: "fm-client",
        beneficiaryFamilyMemberId: "fm-emma",
        rothRolloverEnabled: false,
      } as never,
      ctx,
    );
    expect(acct.owners).toEqual([
      { kind: "external_beneficiary", externalBeneficiaryId: EDUCATION_529_SENTINEL_OWNER_ID, percent: 1 },
    ]);
    expect(acct.realization).toBeUndefined();
    expect(acct.education529).toMatchObject({
      grantorFamilyMemberId: "fm-client",
      beneficiaryFamilyMemberId: "fm-emma",
    });
  });
});
