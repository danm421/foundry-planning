import { describe, it, expect } from "vitest";
import { prepareLifeInsurancePayouts } from "../life-insurance-payout";
import type { Account, LifeInsurancePolicy } from "../../types";
import { LEGACY_FM_CLIENT } from "../../ownership";

const mkPolicy = (over: Partial<LifeInsurancePolicy> = {}): LifeInsurancePolicy => ({
  faceValue: 1_000_000,
  costBasis: 0,
  premiumAmount: 0,
  premiumYears: null,
  policyType: "whole",
  termIssueYear: null,
  termLengthYears: null,
  endsAtInsuredRetirement: false,
  cashValueGrowthMode: "basic",
  postPayoutGrowthRate: 0.06,
  cashValueSchedule: [],
  ...over,
});

const mkAccount = (over: Partial<Account> = {}): Account => ({
  id: "pol-1",
  name: "Whole life policy",
  category: "life_insurance",
  subType: "whole_life",
  value: 50_000,
  basis: 0,
  growthRate: 0.04,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  insuredPerson: "client",
  lifeInsurance: mkPolicy(),
  ...over,
});

describe("prepareLifeInsurancePayouts", () => {
  it("transforms a single-insured policy when insured === deceased", () => {
    const acct = mkAccount({ insuredPerson: "client" });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(result.accountBalances["pol-1"]).toBe(1_000_000);
    expect(result.basisMap["pol-1"]).toBe(1_000_000);
    expect(result.accounts[0].category).toBe("cash");
    expect(result.accounts[0].subType).toBe("life_insurance_proceeds");
    expect(result.accounts[0].lifeInsurance).toBeUndefined();
    expect(result.accounts[0].insuredPerson).toBeUndefined();
    expect(result.retiredPolicyIds).toEqual(["pol-1"]);
  });

  it("leaves a single-insured policy unchanged when insured !== deceased", () => {
    const acct = mkAccount({ insuredPerson: "spouse" });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(result.accounts[0].category).toBe("life_insurance");
    expect(result.accountBalances["pol-1"]).toBe(50_000);
    expect(result.retiredPolicyIds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("defers joint-insured payout to final_death", () => {
    const acct = mkAccount({ insuredPerson: "joint" });
    const first = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(first.accountBalances["pol-1"]).toBe(50_000);
    expect(first.retiredPolicyIds).toEqual([]);

    const final = prepareLifeInsurancePayouts({
      year: 2050, deceased: "spouse", eventKind: "final_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(final.accountBalances["pol-1"]).toBe(1_000_000);
    expect(final.accounts[0].category).toBe("cash");
  });

  it("preserves entity ownership and beneficiaries on the transformed account", () => {
    const acct = mkAccount({
      owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
      beneficiaries: [
        { id: "ref-1", tier: "primary", percentage: 100, familyMemberId: "kid-1", sortOrder: 0 },
      ],
    });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 0 },
      basisMap: { "pol-1": 0 },
      entities: [
        { id: "ilit-1", includeInPortfolio: false, isGrantor: false,
          isIrrevocable: true, grantor: "client" },
      ],
    });
    expect(result.accounts[0].owners).toEqual([{ kind: "entity", entityId: "ilit-1", percent: 1 }]);
    expect(result.accounts[0].beneficiaries).toHaveLength(1);
    expect(result.accountBalances["pol-1"]).toBe(1_000_000);
    expect(result.basisMap["pol-1"]).toBe(1_000_000);
  });

  it("standalone-mode with model-portfolio realization → taxable account with realization mix", () => {
    const acct = mkAccount({
      lifeInsurance: mkPolicy({
        postPayoutGrowthRate: 0.072,
        postPayoutRealization: {
          pctOrdinaryIncome: 0.05,
          pctLtCapitalGains: 0.6,
          pctQualifiedDividends: 0.25,
          pctTaxExempt: 0.1,
          turnoverPct: 0,
        },
      }),
    });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    const transformed = result.accounts.find((a) => a.id === "pol-1");
    expect(transformed?.category).toBe("taxable");
    expect(transformed?.subType).toBe("life_insurance_proceeds");
    expect(transformed?.growthRate).toBeCloseTo(0.072, 6);
    expect(transformed?.realization).toEqual({
      pctOrdinaryIncome: 0.05,
      pctLtCapitalGains: 0.6,
      pctQualifiedDividends: 0.25,
      pctTaxExempt: 0.1,
      turnoverPct: 0,
    });
    expect(result.accountBalances["pol-1"]).toBe(1_000_000);
    expect(result.basisMap["pol-1"]).toBe(1_000_000);
  });

  it("standalone-mode without model portfolio still produces a cash account (no realization)", () => {
    const acct = mkAccount({
      lifeInsurance: mkPolicy({ postPayoutGrowthRate: 0.05 }),
    });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    const transformed = result.accounts.find((a) => a.id === "pol-1");
    expect(transformed?.category).toBe("cash");
    expect(transformed?.realization).toBeUndefined();
    expect(transformed?.growthRate).toBeCloseTo(0.05, 6);
  });

  it("emits no-beneficiaries warning when policy has no primary beneficiaries", () => {
    const acct = mkAccount({ beneficiaries: undefined });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(result.warnings).toContain("life_insurance_no_beneficiaries:pol-1");
  });

  it("emits no-beneficiaries warning when only contingent beneficiaries exist", () => {
    const acct = mkAccount({
      beneficiaries: [
        { id: "ref-1", tier: "contingent", percentage: 100, familyMemberId: "kid-1", sortOrder: 0 },
      ],
    });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(result.warnings).toContain("life_insurance_no_beneficiaries:pol-1");
  });

  it("does not warn when at least one primary beneficiary is present", () => {
    const acct = mkAccount({
      beneficiaries: [
        { id: "ref-1", tier: "primary", percentage: 100, familyMemberId: "kid-1", sortOrder: 0 },
      ],
    });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(result.warnings.filter((w) => w.startsWith("life_insurance_no_beneficiaries"))).toHaveLength(0);
  });

  it("passes through non-life-insurance accounts untouched", () => {
    const pol = mkAccount({ insuredPerson: "client" });
    const cash: Account = {
      id: "cash-1", name: "Checking", category: "cash", subType: "checking",
      value: 20_000, basis: 20_000, growthRate: 0.005, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [pol, cash],
      accountBalances: { "pol-1": 0, "cash-1": 20_000 },
      basisMap: { "pol-1": 0, "cash-1": 20_000 },
      entities: [],
    });
    expect(result.accounts.find((a) => a.id === "cash-1")).toEqual(cash);
    expect(result.accountBalances["cash-1"]).toBe(20_000);
    expect(result.basisMap["cash-1"]).toBe(20_000);
  });
});
