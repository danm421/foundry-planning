import { describe, it, expect } from "vitest";
import {
  buildQsContext,
  incomePayload,
  ssPatch,
  accountPayload,
  liabilityPayload,
  livingExpensePayload,
  savingsPayload,
  insurancePayload,
  planSettingsPayload,
} from "../derive";

const client = {
  dateOfBirth: "1965-04-15",
  retirementAge: 65,
  planEndAge: 95,
  spouseDob: "1967-09-22",
  spouseRetirementAge: 63,
};
const ctx = buildQsContext({
  client,
  planStartYear: 2026,
  planEndYear: 2060,
  clientFirstName: "Alice",
  spouseFirstName: "Bob",
  hasSpouse: true,
});

describe("incomePayload", () => {
  it("salary: earned income, name from owner, ends at owner retirement", () => {
    const p = incomePayload({ kind: "salary", owner: "client", amount: 200000 }, ctx);
    expect(p.type).toBe("salary");
    expect(p.name).toBe("Alice - Salary");
    expect(p.taxType).toBe("earned_income");
    expect(p.annualAmount).toBe(200000);
    expect(p.owner).toBe("client");
    expect(p.startYearRef).toBe("plan_start");
    expect(p.endYearRef).toBe("client_retirement");
    expect(p.startYear).toBe(2026);
    // client retires at 65 in 2030; end resolves to year-1 => 2029
    expect(p.endYear).toBe(2029);
    expect(p.growthSource).toBe("inflation");
  });

  it("pension: type=deferred, ordinary income, growth 0, retirement->end", () => {
    const p = incomePayload({ kind: "pension", owner: "spouse", amount: 40000 }, ctx);
    expect(p.type).toBe("deferred");
    expect(p.name).toBe("Bob - Pension");
    expect(p.taxType).toBe("ordinary_income");
    expect(p.growthRate).toBe("0");
    expect(p.growthSource).toBe("custom");
    expect(p.startYearRef).toBe("spouse_retirement");
    expect(p.endYearRef).toBe("spouse_end");
  });

  it("other: ordinary income, full plan span", () => {
    const p = incomePayload({ kind: "other", owner: "joint", amount: 12000 }, ctx);
    expect(p.type).toBe("other");
    expect(p.name).toBe("Joint - Other income");
    expect(p.taxType).toBe("ordinary_income");
    expect(p.startYearRef).toBe("plan_start");
    expect(p.endYearRef).toBe("plan_end");
  });
});

describe("ssPatch", () => {
  it("maps monthly benefit + age to pia_at_fra fields", () => {
    expect(ssPatch({ monthlyBenefit: 3000, claimingAge: 70 })).toEqual({
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 3000,
      claimingAge: 70,
      claimingAgeMonths: 0,
    });
  });
});

describe("accountPayload", () => {
  it("cash: basis=value, subtype savings", () => {
    const p = accountPayload({ kind: "cash", owner: "client", value: 50000 }, ctx);
    expect(p).toMatchObject({
      category: "cash",
      subType: "savings",
      value: 50000,
      basis: 50000,
      owner: "client",
    });
    expect(p.name).toBe("Alice - Cash");
  });
  it("taxable: basis mirrors value unless given, brokerage", () => {
    const p = accountPayload({ kind: "taxable", owner: "joint", value: 100000 }, ctx);
    expect(p).toMatchObject({ category: "taxable", subType: "brokerage", value: 100000, basis: 100000 });
    const p2 = accountPayload({ kind: "taxable", owner: "joint", value: 100000, basis: 60000 }, ctx);
    expect(p2.basis).toBe(60000);
  });
  it("retirement: basis 0, subtype passed through", () => {
    const p = accountPayload({ kind: "retirement", owner: "spouse", value: 250000, subType: "401k" }, ctx);
    expect(p).toMatchObject({ category: "retirement", subType: "401k", value: 250000, basis: 0 });
  });
  it("real_estate: primary residence subtype", () => {
    const p = accountPayload({ kind: "real_estate", owner: "joint", value: 600000 }, ctx);
    expect(p.category).toBe("real_estate");
    expect(p.subType).toBe("primary_residence");
  });
});

describe("liabilityPayload", () => {
  it("computes monthly payment from term when omitted", () => {
    const p = liabilityPayload({ name: "Mortgage", balance: 300000, interestRate: 0.06, termYears: 30 }, ctx);
    expect(p.name).toBe("Mortgage");
    expect(p.startYear).toBe(2026);
    expect(p.termMonths).toBe(360);
    // 300k @ 6%/30y ≈ 1798.65
    expect(Math.round(Number(p.monthlyPayment))).toBe(1799);
  });
});

describe("livingExpensePayload", () => {
  it("current: plan_start -> client_retirement", () => {
    const p = livingExpensePayload("current", 80000, ctx);
    expect(p).toMatchObject({
      type: "living",
      name: "Current Living Expenses",
      annualAmount: 80000,
      startYearRef: "plan_start",
      endYearRef: "client_retirement",
      startYear: 2026,
    });
  });
  it("retirement: client_retirement -> plan_end", () => {
    const p = livingExpensePayload("retirement", 60000, ctx);
    expect(p).toMatchObject({
      type: "living",
      name: "Retirement Living Expenses",
      annualAmount: 60000,
      startYearRef: "client_retirement",
      endYearRef: "plan_end",
      endYear: 2060,
    });
  });
});

describe("savingsPayload", () => {
  it("workplace percent + employer percent match", () => {
    const p = savingsPayload(
      {
        accountId: "acc1",
        accountCategory: "retirement",
        accountSubType: "401k",
        mode: "percent",
        percent: 0.1,
        roth: false,
        matchMode: "percent",
        matchPercent: 0.5,
        matchCap: 0.06,
      },
      ctx,
    );
    expect(p.accountId).toBe("acc1");
    expect(p.annualPercent).toBe(0.1);
    expect(p.employerMatchPct).toBe(0.5);
    expect(p.employerMatchCap).toBe(0.06);
    expect(p.isDeductible).toBe(true); // 401k default
  });
  it("max mode sets contributeMax", () => {
    const p = savingsPayload(
      { accountId: "ira1", accountCategory: "retirement", accountSubType: "traditional_ira", mode: "max" },
      ctx,
    );
    expect(p.contributeMax).toBe(true);
  });
});

describe("insurancePayload", () => {
  it("term policy carries issue year + term length, family ownerRef", () => {
    const p = insurancePayload(
      { insured: "client", policyType: "term", faceValue: 1000000, premiumAmount: 1200, termLengthYears: 20 },
      ctx,
    );
    expect(p.policyType).toBe("term");
    expect(p.insuredPerson).toBe("client");
    expect(p.faceValue).toBe(1000000);
    expect(p.termIssueYear).toBe(2026);
    expect(p.termLengthYears).toBe(20);
    // ownerRef.id is filled by the step from bootstrap.familyMemberIds; undefined here.
    expect(p.ownerRef).toEqual({ kind: "family", id: undefined });
  });
  it("fills ownerRef.id when family member id is supplied", () => {
    const p = insurancePayload(
      { insured: "spouse", policyType: "whole", faceValue: 500000, premiumAmount: 4000 },
      ctx,
      "fam-spouse",
    );
    expect(p.ownerRef).toEqual({ kind: "family", id: "fam-spouse" });
    expect(p.termIssueYear).toBeNull();
    expect(p.termLengthYears).toBeNull();
  });
});

const baseAssumptions = {
  inflationRate: 0.03,
  growthTaxable: 0.07,
  growthCash: 0.02,
  growthRetirement: 0.07,
  growthRealEstate: 0.04,
  growthLifeInsurance: 0.03,
  growthSourceTaxable: "custom" as const,
  growthSourceCash: "custom" as const,
  growthSourceRetirement: "custom" as const,
  modelPortfolioIdTaxable: null,
  modelPortfolioIdCash: null,
  modelPortfolioIdRetirement: null,
  growthSourceRealEstate: "custom" as const,
  growthSourceLifeInsurance: "custom" as const,
};

describe("planSettingsPayload", () => {
  it("brackets mode sets taxEngineMode + residenceState, keeps growth rates", () => {
    const p = planSettingsPayload({ taxMode: "brackets", ...baseAssumptions }, "CA");
    expect(p.taxEngineMode).toBe("bracket");
    expect((p as { residenceState: string }).residenceState).toBe("CA");
    expect(p.defaultGrowthTaxable).toBe(0.07);
    expect(p.inflationRate).toBe(0.03);
  });

  it("flat mode sets rates and engine mode flat", () => {
    const p = planSettingsPayload(
      { taxMode: "flat", flatFederalRate: 0.22, flatStateRate: 0.05, ...baseAssumptions },
      "CA",
    );
    expect(p.taxEngineMode).toBe("flat");
    expect((p as { flatFederalRate: number }).flatFederalRate).toBe(0.22);
    expect((p as { flatStateRate: number }).flatStateRate).toBe(0.05);
  });

  it("emits growth source + portfolio id when a category uses a model portfolio", () => {
    const p = planSettingsPayload(
      {
        taxMode: "brackets",
        ...baseAssumptions,
        growthSourceTaxable: "model_portfolio",
        modelPortfolioIdTaxable: "pf-123",
      },
      null,
    );
    expect(p.growthSourceTaxable).toBe("model_portfolio");
    expect(p.modelPortfolioIdTaxable).toBe("pf-123");
  });

  it("nulls the portfolio id for non-model-portfolio sources, and passes flat sources through", () => {
    const p = planSettingsPayload(
      {
        taxMode: "brackets",
        ...baseAssumptions,
        // stale id present but source is inflation -> must be cleared to null
        growthSourceCash: "inflation",
        modelPortfolioIdCash: "pf-should-be-cleared",
        growthSourceRealEstate: "inflation",
      },
      null,
    );
    expect(p.growthSourceCash).toBe("inflation");
    expect(p.modelPortfolioIdCash).toBeNull();
    expect(p.growthSourceRealEstate).toBe("inflation");
    expect(p.growthSourceLifeInsurance).toBe("custom");
  });
});
