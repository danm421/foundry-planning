import { describe, it, expect } from "vitest";
import {
  resolveAccountFromRaw,
  resolveIncomeFromRaw,
  resolveExpenseFromRaw,
  resolveSavingsRuleFromRaw,
  type ResolutionContext,
} from "../resolve-entity";
import { createGrowthSourceResolver } from "../resolve-growth-source";

function makeCtx(overrides: Partial<{ inflationRate: number }> = {}): ResolutionContext {
  const resolver = createGrowthSourceResolver({
    planSettings: {
      growthSourceTaxable: "default",
      growthSourceCash: "default",
      growthSourceRetirement: "default",
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
  });
  return {
    resolver,
    resolvedInflationRate: overrides.inflationRate ?? 0.025,
    beneficiariesByAccountId: new Map(),
    policiesByAccount: {},
    ownersByAccountId: new Map(),
  };
}

const baseRawAccount = {
  turnoverPct: "0",
  annualPropertyTax: "0",
  propertyTaxGrowthRate: "0",
  rmdEnabled: false,
  isDefaultChecking: false,
  modelPortfolioId: null,
  overridePctOi: null,
  overridePctLtCg: null,
  overridePctQdiv: null,
  overridePctTaxExempt: null,
  priorYearEndValue: null,
  insuredPerson: null,
  owners: [],
};

describe("resolveAccountFromRaw", () => {
  it("resolves growthRate from category default when growthSource is 'default'", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a1",
        name: "Brokerage",
        category: "taxable",
        subType: "individual",
        value: "100000",
        basis: "100000",
        growthSource: "default",
        growthRate: null,
      },
      makeCtx(),
    );
    expect(typeof acct.growthRate).toBe("number");
    expect(acct.growthRate).toBeCloseTo(0.07);
  });

  it("uses inflation rate when growthSource is 'inflation'", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a2",
        name: "Cash",
        category: "cash",
        subType: "checking",
        value: "10000",
        basis: "10000",
        growthSource: "inflation",
        growthRate: null,
        isDefaultChecking: true,
      },
      makeCtx({ inflationRate: 0.03 }),
    );
    expect(acct.growthRate).toBeCloseTo(0.03);
    expect(acct.realization?.pctOrdinaryIncome).toBe(1);
  });

  it("forces 100% OI realization for cash regardless of source", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a3",
        name: "Savings",
        category: "cash",
        subType: "savings",
        value: "5000",
        basis: "5000",
        growthSource: "default",
        growthRate: null,
      },
      makeCtx(),
    );
    expect(acct.realization).toEqual({
      pctOrdinaryIncome: 1,
      pctLtCapitalGains: 0,
      pctQualifiedDividends: 0,
      pctTaxExempt: 0,
      turnoverPct: 0,
    });
  });

  it("strips realization for retirement accounts", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a4",
        name: "401k",
        category: "retirement",
        subType: "traditional_401k",
        value: "200000",
        basis: "0",
        growthSource: "default",
        growthRate: null,
        rmdEnabled: true,
      },
      makeCtx(),
    );
    expect(acct.realization).toBeUndefined();
    expect(typeof acct.growthRate).toBe("number");
    expect(acct.growthRate).toBeCloseTo(0.06);
  });

  it("uses flat defaults for real_estate / business / life_insurance with no realization", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a5",
        name: "Home",
        category: "real_estate",
        subType: "primary_residence",
        value: "500000",
        basis: "300000",
        growthSource: "custom",
        growthRate: null,
        annualPropertyTax: "5000",
        propertyTaxGrowthRate: "0.02",
      },
      makeCtx(),
    );
    expect(acct.growthRate).toBeCloseTo(0.04);
    expect(acct.realization).toBeUndefined();
  });

  it("honors explicit custom growthRate", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a6",
        name: "Brokerage Custom",
        category: "taxable",
        subType: "individual",
        value: "50000",
        basis: "50000",
        growthSource: "custom",
        growthRate: "0.09",
      },
      makeCtx(),
    );
    expect(acct.growthRate).toBeCloseTo(0.09);
  });
});

describe("resolveIncomeFromRaw", () => {
  it("uses inflation rate when growthSource is 'inflation'", () => {
    const inc = resolveIncomeFromRaw(
      {
        id: "i1",
        type: "salary",
        name: "Job",
        annualAmount: "100000",
        startYear: 2025,
        endYear: 2050,
        growthSource: "inflation",
        growthRate: null,
        owner: "client",
      },
      makeCtx({ inflationRate: 0.025 }),
    );
    expect(inc.growthRate).toBeCloseTo(0.025);
  });

  it("uses explicit growthRate when source is not inflation", () => {
    const inc = resolveIncomeFromRaw(
      {
        id: "i2",
        type: "salary",
        name: "Job",
        annualAmount: "100000",
        startYear: 2025,
        endYear: 2050,
        growthSource: "custom",
        growthRate: "0.04",
        owner: "client",
      },
      makeCtx({ inflationRate: 0.025 }),
    );
    expect(inc.growthRate).toBeCloseTo(0.04);
  });
});

describe("resolveExpenseFromRaw", () => {
  it("uses inflation rate when growthSource is 'inflation'", () => {
    const exp = resolveExpenseFromRaw(
      {
        id: "e1",
        type: "living",
        name: "Living",
        annualAmount: "60000",
        startYear: 2025,
        endYear: 2060,
        growthSource: "inflation",
        growthRate: null,
      },
      makeCtx({ inflationRate: 0.03 }),
    );
    expect(exp.growthRate).toBeCloseTo(0.03);
  });

  it("uses explicit growthRate when source is not inflation", () => {
    const exp = resolveExpenseFromRaw(
      {
        id: "e2",
        type: "other",
        name: "Vacation",
        annualAmount: "10000",
        startYear: 2025,
        endYear: 2060,
        growthSource: "custom",
        growthRate: "0.02",
      },
      makeCtx({ inflationRate: 0.03 }),
    );
    expect(exp.growthRate).toBeCloseTo(0.02);
  });
});

describe("resolveSavingsRuleFromRaw", () => {
  it("uses inflation rate when growthSource is 'inflation'", () => {
    const rule = resolveSavingsRuleFromRaw(
      {
        id: "s1",
        accountId: "a1",
        annualAmount: "20000",
        annualPercent: null,
        isDeductible: true,
        applyContributionLimit: true,
        contributeMax: false,
        startYear: 2025,
        endYear: 2050,
        growthSource: "inflation",
        growthRate: null,
      },
      makeCtx({ inflationRate: 0.025 }),
    );
    expect(rule.growthRate).toBeCloseTo(0.025);
  });

  it("uses explicit growthRate when source is not inflation", () => {
    const rule = resolveSavingsRuleFromRaw(
      {
        id: "s2",
        accountId: "a1",
        annualAmount: "20000",
        annualPercent: null,
        isDeductible: false,
        applyContributionLimit: true,
        contributeMax: false,
        startYear: 2025,
        endYear: 2050,
        growthSource: "custom",
        growthRate: "0.05",
      },
      makeCtx(),
    );
    expect(rule.growthRate).toBeCloseTo(0.05);
  });
});
