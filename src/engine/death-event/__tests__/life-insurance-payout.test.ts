import { describe, it, expect } from "vitest";
import { prepareLifeInsurancePayouts } from "../life-insurance-payout";
import type { Account, EntitySummary, LifeInsurancePolicy } from "../../types";

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
  postPayoutMergeAccountId: null,
  postPayoutGrowthRate: 0.06,
  cashValueSchedule: [],
  ...over,
});

const mkAccount = (over: Partial<Account> = {}): Account => ({
  id: "pol-1",
  name: "Whole life policy",
  category: "life_insurance",
  subType: "whole_life",
  owner: "client",
  value: 50_000,
  basis: 0,
  growthRate: 0.04,
  rmdEnabled: false,
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

  it("preserves owner, ownerEntityId, and beneficiaries on the transformed account", () => {
    const acct = mkAccount({
      owner: "client",
      ownerEntityId: "ilit-1",
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
    expect(result.accounts[0].owner).toBe("client");
    expect(result.accounts[0].ownerEntityId).toBe("ilit-1");
    expect(result.accounts[0].beneficiaries).toHaveLength(1);
    expect(result.accountBalances["pol-1"]).toBe(1_000_000);
    expect(result.basisMap["pol-1"]).toBe(1_000_000);
  });

  it("merge-target mode moves faceValue into target and removes the policy account", () => {
    const acct = mkAccount({
      lifeInsurance: mkPolicy({ postPayoutMergeAccountId: "spouse-brokerage" }),
    });
    const spouseBrokerage: Account = {
      id: "spouse-brokerage", name: "Spouse brokerage", category: "taxable",
      subType: "brokerage", owner: "spouse", value: 500_000, basis: 400_000,
      growthRate: 0.06, rmdEnabled: false,
    };
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct, spouseBrokerage],
      accountBalances: { "pol-1": 50_000, "spouse-brokerage": 500_000 },
      basisMap: { "pol-1": 0, "spouse-brokerage": 400_000 },
      entities: [],
    });
    expect(result.accounts.find((a) => a.id === "pol-1")).toBeUndefined();
    expect(result.accountBalances["pol-1"]).toBeUndefined();
    expect(result.basisMap["pol-1"]).toBeUndefined();
    expect(result.accountBalances["spouse-brokerage"]).toBe(1_500_000);
    expect(result.basisMap["spouse-brokerage"]).toBe(1_400_000);
    expect(result.retiredPolicyIds).toEqual(["pol-1"]);
  });

  it("merge-target falls back to standalone when target id does not exist", () => {
    const acct = mkAccount({
      lifeInsurance: mkPolicy({ postPayoutMergeAccountId: "does-not-exist" }),
    });
    const result = prepareLifeInsurancePayouts({
      year: 2040, deceased: "client", eventKind: "first_death",
      accounts: [acct],
      accountBalances: { "pol-1": 50_000 },
      basisMap: { "pol-1": 0 },
      entities: [],
    });
    expect(result.accounts[0].id).toBe("pol-1");
    expect(result.accounts[0].category).toBe("cash");
    expect(result.accountBalances["pol-1"]).toBe(1_000_000);
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
      owner: "client", value: 20_000, basis: 20_000, growthRate: 0.005, rmdEnabled: false,
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
