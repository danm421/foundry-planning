import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import {
  contractDeathBenefitForYear,
  deathBenefitForYear,
  ltcAcceleratedThrough,
  ltcCashValueShare,
} from "../life-insurance-schedule";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type { Account, ClientData, LifeInsurancePolicy } from "../types";

const policy = (over: Partial<LifeInsurancePolicy> = {}): LifeInsurancePolicy => ({
  faceValue: 500_000, costBasis: 0, premiumAmount: 0, premiumYears: null, premiumPayer: "owner",
  policyType: "whole", termIssueYear: null, termLengthYears: null, endsAtInsuredRetirement: false,
  cashValueGrowthMode: "basic", premiumScheduleMode: "off", deathBenefitScheduleMode: "off",
  incomeScheduleMode: "off", postPayoutGrowthRate: 0, cashValueSchedule: [], ...over,
});
const drew = { byYear: { 2055: 120_000, 2056: 120_000 }, minimumDeathBenefit: 0 };

describe("death benefit after rider draws", () => {
  it("is the contract figure less every draw so far", () => {
    const p = policy({ ltcAcceleration: drew });
    expect(ltcAcceleratedThrough(p, 2054)).toBe(0);
    expect(ltcAcceleratedThrough(p, 2056)).toBe(240_000);
    expect(deathBenefitForYear(p, 2054)).toBe(500_000);
    expect(deathBenefitForYear(p, 2055)).toBe(380_000); // 500,000 − 120,000
    expect(deathBenefitForYear(p, 2070)).toBe(260_000); // 500,000 − 240,000
  });

  it("never falls below the guaranteed minimum, nor rises above the contract figure", () => {
    expect(deathBenefitForYear(policy({ ltcAcceleration: { ...drew, minimumDeathBenefit: 300_000 } }), 2056)).toBe(300_000);
    // Contract 200,000 (schedule) < minimum 300,000: the payout stays at the contract's 200,000.
    const low = policy({
      deathBenefitScheduleMode: "scheduled",
      cashValueSchedule: [{ year: 2050, deathBenefit: 200_000 }],
      ltcAcceleration: { byYear: { 2055: 50_000 }, minimumDeathBenefit: 300_000 },
    });
    expect(deathBenefitForYear(low, 2055)).toBe(200_000);
  });

  it("reduces the SCHEDULED death benefit when the policy uses one", () => {
    const p = policy({
      deathBenefitScheduleMode: "scheduled",
      cashValueSchedule: [{ year: 2050, deathBenefit: 800_000 }],
      ltcAcceleration: { byYear: { 2055: 100_000 }, minimumDeathBenefit: 0 },
    });
    expect(contractDeathBenefitForYear(p, 2055)).toBe(800_000);
    expect(deathBenefitForYear(p, 2055)).toBe(700_000); // 800,000 − 100,000, not 500,000 face − 100,000
  });

  it("the cash value keeps 1 − drawn ÷ death benefit", () => {
    const p = policy({ ltcAcceleration: drew });
    expect(ltcCashValueShare(p, 2054)).toBe(1);
    expect(ltcCashValueShare(p, 2055)).toBeCloseTo(0.76, 10); // 1 − 120,000 / 500,000
    expect(ltcCashValueShare(p, 2056)).toBeCloseTo(0.52, 10); // 1 − 240,000 / 500,000
    expect(ltcCashValueShare(policy({ ltcAcceleration: { byYear: { 2055: 500_000 }, minimumDeathBenefit: 0 } }), 2055)).toBe(0);
  });

  it("a policy with no rider draws is untouched", () => {
    expect(deathBenefitForYear(policy(), 2055)).toBe(500_000);
    expect(ltcCashValueShare(policy(), 2055)).toBe(1);
  });
});

// John (1960) dies at 70 in 2030; Jane (1962) lives to 95. No tax, no inflation.
function plan(li: Partial<LifeInsurancePolicy>, value = 100_000): ClientData {
  const account: Account = {
    id: "pol-1", name: "Whole Life", category: "life_insurance", subType: "whole", titlingType: "jtwros",
    insuredPerson: "client", value, basis: 0, growthRate: 0, rmdEnabled: false,
    lifeInsurance: policy({ faceValue: 1_000_000, ...li }),
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, familyMemberId: LEGACY_FM_SPOUSE, sortOrder: 0 }],
  };
  return {
    client: {
      firstName: "John", lastName: "Doe", dateOfBirth: "1960-01-01", retirementAge: 65, planEndAge: 100,
      filingStatus: "married_joint", lifeExpectancy: 70, spouseName: "Jane Doe", spouseDob: "1962-01-01",
      spouseRetirementAge: 65, spouseLifeExpectancy: 95,
    },
    accounts: [account], incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0, flatStateRate: 0, inflationRate: 0, planStartYear: 2026, planEndYear: 2066,
      taxInflationRate: 0, estateAdminExpenses: 0, flatStateEstateRate: 0,
    },
    familyMembers: [
      { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "John", lastName: "Doe", dateOfBirth: "1960-01-01" },
      { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Jane", lastName: "Doe", dateOfBirth: "1962-01-01" },
    ],
    giftEvents: [],
  };
}
const proceeds = (data: ClientData) =>
  runProjection(data).find((y) => y.year === 2030)!.income.bySource["life-insurance-proceeds:pol-1"];
const cashValue = (data: ClientData, year: number) =>
  runProjection(data).find((y) => y.year === year)!.portfolioAssets.lifeInsurance["pol-1"];

describe("the projection pays and values the reduced policy", () => {
  it("the death payout is face less the rider's draws, never below the guaranteed minimum", () => {
    expect(proceeds(plan({}))).toBe(1_000_000); // control
    // 1,000,000 − (300,000 + 200,000) = 500,000
    expect(proceeds(plan({ ltcAcceleration: { byYear: { 2029: 300_000, 2030: 200_000 }, minimumDeathBenefit: 0 } }))).toBe(500_000);
    expect(proceeds(plan({ ltcAcceleration: { byYear: { 2029: 300_000, 2030: 200_000 }, minimumDeathBenefit: 600_000 } }))).toBe(600_000);
  });

  it("a basic cash value shrinks with the draws", () => {
    // 100,000, no growth. Draws 200,000 in 2027 and 300,000 in 2028 against a 1,000,000 face:
    // 2027 keeps 1 − 0.2 = 80% → 80,000; 2028 keeps 1 − 0.5 = 50% → 50,000; 2029 unchanged.
    const data = plan({ ltcAcceleration: { byYear: { 2027: 200_000, 2028: 300_000 }, minimumDeathBenefit: 0 } });
    expect(cashValue(data, 2026)).toBeCloseTo(100_000, 6);
    expect(cashValue(data, 2027)).toBeCloseTo(80_000, 6);
    expect(cashValue(data, 2028)).toBeCloseTo(50_000, 6);
    expect(cashValue(data, 2029)).toBeCloseTo(50_000, 6);
  });

  it("a free-form cash value shrinks after its schedule sets it", () => {
    const data = plan({
      cashValueGrowthMode: "free_form",
      cashValueSchedule: [{ year: 2026, cashValue: 100_000 }],
      ltcAcceleration: { byYear: { 2027: 200_000, 2028: 300_000 }, minimumDeathBenefit: 0 },
    });
    expect(cashValue(data, 2027)).toBeCloseTo(80_000, 6);
    expect(cashValue(data, 2028)).toBeCloseTo(50_000, 6);
  });
});
