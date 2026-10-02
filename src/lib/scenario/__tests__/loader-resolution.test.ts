import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs, resolveAddPayload } from "../loader";
import { createGrowthSourceResolver } from "@/lib/projection/resolve-growth-source";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { Account, ClientData } from "@/engine/types";

type GrowthInputs = Parameters<typeof createGrowthSourceResolver>[0];

function makeCtx(
  portfolios: Partial<
    Pick<GrowthInputs, "assetClasses" | "modelPortfolios" | "modelPortfolioAllocations">
  > = {},
): ResolutionContext {
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
    assetClasses: portfolios.assetClasses ?? [],
    modelPortfolios: portfolios.modelPortfolios ?? [],
    modelPortfolioAllocations: portfolios.modelPortfolioAllocations ?? [],
    accountAssetAllocations: [],
    clientCmaOverrides: [],
  });
  return {
    resolver,
    resolvedInflationRate: 0.025,
    beneficiariesByAccountId: new Map(),
    policiesByAccount: {},
    ownersByAccountId: new Map(),
  };
}

const baseChange: Omit<ScenarioChange, "opType" | "targetKind" | "payload"> = {
  id: "ch1",
  scenarioId: "scn1",
  targetId: "added-1",
  toggleGroupId: null,
  orderIndex: 0,
};

describe("resolveAddPayload", () => {
  it("transforms an account add payload — null growthRate becomes a number", () => {
    const change: ScenarioChange = {
      ...baseChange,
      opType: "add",
      targetKind: "account",
      payload: {
        id: "added-1",
        name: "Scenario Brokerage",
        category: "taxable",
        subType: "individual",
        value: "100000",
        basis: "100000",
        growthSource: "default",
        growthRate: null,
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
      },
    };
    const out = resolveAddPayload(change, makeCtx());
    const acct = out.payload as { growthRate: number; value: number };
    expect(typeof acct.growthRate).toBe("number");
    expect(acct.growthRate).toBeCloseTo(0.07);
    expect(acct.value).toBe(100000);
  });

  it("transforms an income add payload — string growthRate '0' for inflation source becomes resolvedInflationRate", () => {
    const change: ScenarioChange = {
      ...baseChange,
      opType: "add",
      targetKind: "income",
      payload: {
        id: "inc-1",
        type: "salary",
        name: "Job",
        annualAmount: "100000",
        startYear: 2025,
        endYear: 2050,
        growthSource: "inflation",
        growthRate: null,
        owner: "client",
      },
    };
    const out = resolveAddPayload(change, makeCtx());
    const inc = out.payload as { growthRate: number; annualAmount: number };
    expect(inc.growthRate).toBeCloseTo(0.025);
    expect(inc.annualAmount).toBe(100000);
  });

  it("transforms an expense add payload", () => {
    const change: ScenarioChange = {
      ...baseChange,
      opType: "add",
      targetKind: "expense",
      payload: {
        id: "exp-1",
        type: "living",
        name: "Living",
        annualAmount: "60000",
        startYear: 2025,
        endYear: 2060,
        growthSource: "inflation",
        growthRate: null,
      },
    };
    const out = resolveAddPayload(change, makeCtx());
    const exp = out.payload as { growthRate: number };
    expect(exp.growthRate).toBeCloseTo(0.025);
  });

  it("transforms a savings_rule add payload", () => {
    const change: ScenarioChange = {
      ...baseChange,
      opType: "add",
      targetKind: "savings_rule",
      payload: {
        id: "sr-1",
        accountId: "acct-1",
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
    };
    const out = resolveAddPayload(change, makeCtx());
    const rule = out.payload as { growthRate: number };
    expect(rule.growthRate).toBeCloseTo(0.025);
  });

  it("leaves edit ops untouched", () => {
    const change: ScenarioChange = {
      ...baseChange,
      opType: "edit",
      targetKind: "account",
      payload: { value: { from: 1000, to: 2000 } },
    };
    const out = resolveAddPayload(change, makeCtx());
    expect(out).toBe(change);
  });

  it("leaves remove ops untouched", () => {
    const change: ScenarioChange = {
      ...baseChange,
      opType: "remove",
      targetKind: "account",
      payload: null,
    };
    const out = resolveAddPayload(change, makeCtx());
    expect(out).toBe(change);
  });

  it("leaves non-resolvable targetKinds untouched (e.g. transfer)", () => {
    const change: ScenarioChange = {
      ...baseChange,
      opType: "add",
      targetKind: "transfer",
      payload: { id: "t-1", amount: "5000" },
    };
    const out = resolveAddPayload(change, makeCtx());
    expect(out).toBe(change);
  });
});

describe("applyScenarioChangesWithRefs — edited life-insurance post-payout portfolio", () => {
  // `resolveAddPayload` resolves an ADDED policy's post-payout model portfolio,
  // but an `edit` replaces `lifeInsurance` wholesale with the dialog's raw
  // fields, so the edit path has to resolve it as well.
  // One model portfolio: 5%, all ordinary income — distinct from the raw 4%.
  const portfolioCtx = () =>
    makeCtx({
      assetClasses: [
        {
          id: "ac-1",
          geometricReturn: "0.05",
          pctOrdinaryIncome: "1",
          pctLtCapitalGains: "0",
          pctQualifiedDividends: "0",
          pctTaxExempt: "0",
        },
      ],
      modelPortfolios: [{ id: "mp-1" }],
      modelPortfolioAllocations: [{ portfolioId: "mp-1", assetClassId: "ac-1", weight: "1" }],
    });

  const policy = {
    faceValue: 1_000_000,
    costBasis: 0,
    premiumAmount: 0,
    premiumYears: null,
    premiumPayer: "owner",
    policyType: "term",
    termIssueYear: 2020,
    termLengthYears: 20,
    endsAtInsuredRetirement: false,
    cashValueGrowthMode: "basic",
    premiumScheduleMode: "off",
    deathBenefitScheduleMode: "off",
    incomeScheduleMode: "off",
    postPayoutGrowthRate: 0.04,
    postPayoutModelPortfolioId: null,
    cashValueSchedule: [],
  } as unknown as NonNullable<Account["lifeInsurance"]>;

  function tree(): ClientData {
    return {
      client: { dateOfBirth: "1970-06-15", retirementAge: 65, planEndAge: 95, filingStatus: "single" },
      planSettings: { planStartYear: 2025, planEndYear: 2065 },
      accounts: [
        {
          id: "li-1",
          name: "Term policy",
          category: "life_insurance",
          subType: "term",
          value: 0,
          basis: 0,
          growthRate: 0,
          owners: [],
          insuredPerson: "client",
          lifeInsurance: policy,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      transfers: [],
      rothConversions: [],
    } as unknown as ClientData;
  }

  it("resolves the post-payout model portfolio an edit sets", () => {
    const ctx = portfolioCtx();
    const edit: ScenarioChange = {
      ...baseChange,
      targetId: "li-1",
      opType: "edit",
      targetKind: "account",
      payload: {
        lifeInsurance: {
          from: policy,
          to: { ...policy, postPayoutModelPortfolioId: "mp-1" },
        },
      },
    };

    const { effectiveTree } = applyScenarioChangesWithRefs(tree(), [edit], {}, [], ctx);

    const li = effectiveTree.accounts.find((a) => a.id === "li-1")!.lifeInsurance!;
    const p = ctx.resolver.resolvePortfolio("mp-1");
    expect(p.geoReturn).toBeCloseTo(0.05); // the control: the portfolio is not the raw 4%
    expect(li.postPayoutGrowthRate).toBe(p.geoReturn);
    expect(li.postPayoutRealization?.pctOrdinaryIncome).toBe(1);
  });
});
