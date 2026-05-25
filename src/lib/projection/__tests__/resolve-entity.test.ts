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
  titlingType: "jtwros" as const,
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

  it("propagates titlingType from raw to Account (community_property)", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a7",
        name: "Brokerage CP",
        category: "taxable",
        subType: "individual",
        value: "100000",
        basis: "100000",
        growthSource: "default",
        growthRate: null,
        titlingType: "community_property",
      },
      makeCtx(),
    );
    expect(acct.titlingType).toBe("community_property");
  });

  it("propagates titlingType from raw to Account (jtwros)", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a8",
        name: "Brokerage JT",
        category: "taxable",
        subType: "individual",
        value: "100000",
        basis: "100000",
        growthSource: "default",
        growthRate: null,
        titlingType: "jtwros",
      },
      makeCtx(),
    );
    expect(acct.titlingType).toBe("jtwros");
  });

  it("propagates business-as-asset fields onto top-level business accounts", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a9",
        name: "Acme LLC",
        category: "business",
        subType: "operating_business",
        value: "500000",
        basis: "100000",
        growthSource: "custom",
        growthRate: "0.04",
        businessType: "llc",
        distributionPolicyPercent: "0.6",
        flowMode: "annual",
        businessTaxTreatment: "qbi",
        parentAccountId: null,
      },
      makeCtx(),
    );
    expect(acct.businessType).toBe("llc");
    expect(acct.distributionPolicyPercent).toBeCloseTo(0.6);
    expect(acct.flowMode).toBe("annual");
    expect(acct.businessTaxTreatment).toBe("qbi");
    expect(acct.parentAccountId).toBeNull();
  });

  it("propagates parentAccountId on a business-owned child account", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a10",
        name: "Acme Operating Checking",
        category: "cash",
        subType: "checking",
        value: "25000",
        basis: "25000",
        growthSource: "default",
        growthRate: null,
        parentAccountId: "a9",
      },
      makeCtx(),
    );
    expect(acct.parentAccountId).toBe("a9");
    // Non-business child: no business-specific fields populated.
    expect(acct.businessType).toBeNull();
    expect(acct.distributionPolicyPercent).toBeNull();
    expect(acct.businessTaxTreatment).toBeNull();
  });

  it("leaves business-as-asset fields null on a non-business account", () => {
    const acct = resolveAccountFromRaw(
      {
        ...baseRawAccount,
        id: "a11",
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
    expect(acct.businessType).toBeNull();
    expect(acct.distributionPolicyPercent).toBeNull();
    expect(acct.businessTaxTreatment).toBeNull();
    expect(acct.parentAccountId).toBeNull();
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

  it("propagates ownerAccountId onto the resolved Income (business-as-asset)", () => {
    const inc = resolveIncomeFromRaw(
      {
        id: "i3",
        type: "business",
        name: "Acme draw",
        annualAmount: "80000",
        startYear: 2025,
        endYear: 2050,
        growthSource: "custom",
        growthRate: "0.03",
        owner: "client",
        ownerAccountId: "acct-acme",
      },
      makeCtx(),
    );
    expect(inc.ownerAccountId).toBe("acct-acme");
    expect(inc.ownerEntityId).toBeUndefined();
  });

  it("leaves ownerAccountId undefined when raw row omits it", () => {
    const inc = resolveIncomeFromRaw(
      {
        id: "i4",
        type: "salary",
        name: "Job",
        annualAmount: "60000",
        startYear: 2025,
        endYear: 2050,
        growthSource: "custom",
        growthRate: "0.02",
        owner: "client",
      },
      makeCtx(),
    );
    expect(inc.ownerAccountId).toBeUndefined();
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

  it("propagates ownerAccountId onto the resolved Expense (business-as-asset)", () => {
    const exp = resolveExpenseFromRaw(
      {
        id: "e3",
        type: "other",
        name: "Acme rent",
        annualAmount: "24000",
        startYear: 2025,
        endYear: 2060,
        growthSource: "custom",
        growthRate: "0.02",
        ownerAccountId: "acct-acme",
      },
      makeCtx(),
    );
    expect(exp.ownerAccountId).toBe("acct-acme");
    expect(exp.ownerEntityId).toBeUndefined();
  });

  it("leaves ownerAccountId undefined when raw row omits it", () => {
    const exp = resolveExpenseFromRaw(
      {
        id: "e4",
        type: "living",
        name: "Groceries",
        annualAmount: "8000",
        startYear: 2025,
        endYear: 2060,
        growthSource: "custom",
        growthRate: "0.02",
      },
      makeCtx(),
    );
    expect(exp.ownerAccountId).toBeUndefined();
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
