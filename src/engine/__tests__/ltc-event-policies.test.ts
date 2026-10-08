import { describe, it, expect } from "vitest";
import { applyLtcEvent, ltcCareExpenseId } from "../ltc-event";
import { runProjection } from "../projection";
import { ltcBenefitIncomeId, ltcPremiumExpenseId } from "../ltc-benefits";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import { buildClientData, baseClient, basePlanSettings, sampleAccounts, sampleExpenses } from "./fixtures";
import type { Account, ClientData, Expense, LtcPolicy } from "../types";

const ID = "3f1c2d7e-8a1b-4c5d-9e0f-112233445566";
// John (born 1970) in care from 85 for 3 years: 2055–2057, a flat $120,000 a
// year = $10,000 a month, so every figure adds up by hand.
const john = { person: "client" as const, startAge: 85, years: 3, careSetting: "nursing_private" as const, annualCost: 120_000, costInflation: 0 };

const traditional = (over: Partial<LtcPolicy> = {}): LtcPolicy => ({
  id: "trad", name: "Genworth", insured: "client", carrier: null, kind: "standalone",
  lifePolicyAccountId: null, issueYear: 2020, benefitAmount: 6000, benefitUnit: "month",
  riderBenefitMode: null, riderMonthlyPct: null, benefitPeriodMode: "years", benefitPeriodYears: 3,
  riderMaxPct: null, extensionYears: 0, residualDeathBenefit: 0, eliminationDays: 90, homeCarePct: 1,
  inflationRider: "none", inflationRate: 0.03, benefitType: "reimbursement", sharedCare: false,
  annualPremium: 2400, premiumPayMode: "lifetime", premiumPayToAge: null, premiumPayYears: null,
  partnership: false, notes: null, ...over,
});
const rider = (over: Partial<LtcPolicy> = {}): LtcPolicy =>
  traditional({
    id: "rider", name: "Whole life rider", kind: "life_rider", lifePolicyAccountId: "life-1",
    benefitAmount: 0, riderBenefitMode: "pct_of_face", riderMonthlyPct: 0.02,
    benefitPeriodMode: null, benefitPeriodYears: null, riderMaxPct: 1, eliminationDays: 0,
    annualPremium: 0, premiumPayMode: "paid_up", ...over,
  });
const premium = (policyId: string, startYear: number, endYear: number): Expense => ({
  id: ltcPremiumExpenseId(policyId), type: "insurance", name: "LTC premium", annualAmount: 2400,
  startYear, endYear, growthRate: 0, source: "policy",
});
const checking: Account = {
  id: "acct-checking", name: "Joint Checking", category: "cash", subType: "checking", titlingType: "jtwros",
  value: 10_000, basis: 10_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};
const wholeLife: Account = {
  id: "life-1", name: "Whole Life", category: "life_insurance", subType: "whole", titlingType: "jtwros",
  insuredPerson: "client", value: 50_000, basis: 0, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, familyMemberId: LEGACY_FM_SPOUSE, sortOrder: 0 }],
  lifeInsurance: {
    faceValue: 500_000, costBasis: 0, premiumAmount: 0, premiumYears: null, premiumPayer: "owner",
    policyType: "whole", termIssueYear: null, termLengthYears: null, endsAtInsuredRetirement: false,
    cashValueGrowthMode: "basic", premiumScheduleMode: "off", deathBenefitScheduleMode: "off",
    incomeScheduleMode: "off", postPayoutGrowthRate: 0, cashValueSchedule: [],
  },
};

function plan(over: { policies?: LtcPolicy[]; includePolicies?: boolean; expenses?: Expense[]; accounts?: Account[] } = {}): ClientData {
  return buildClientData({
    client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
    planSettings: { ...basePlanSettings, planEndYear: 2067 },
    accounts: over.accounts ?? [...sampleAccounts, checking],
    expenses: over.expenses ?? sampleExpenses,
    ltcPolicies: over.policies ?? [],
    ltcEvents: [{ id: ID, name: "LTC", people: [john], livingExpenseCutPct: null, homeSale: null, includePolicies: over.includePolicies ?? true }],
  });
}
const careRow = (d: ClientData) => d.expenses.find((e) => e.id === ltcCareExpenseId(ID, "client"))!;

describe("applyLtcEvent with LTC policies", () => {
  it("adds a tax-free benefit row and deducts only the uncovered cost", () => {
    const { data } = applyLtcEvent(plan({ policies: [traditional()] }));
    // Benefits: 9 × 6,000 = 54,000, then 72,000, 72,000 (the 216,000 pool covers all three).
    expect(data.incomes.find((i) => i.id === ltcBenefitIncomeId("trad"))!.scheduleOverrides).toEqual({
      2055: 54_000, 2056: 72_000, 2057: 72_000,
    });
    // Medical = 120,000 − benefits: 66,000, 48,000, 48,000.
    expect(careRow(data).medicalDeductibleByYear).toEqual({ 2055: 66_000, 2056: 48_000, 2057: 48_000 });
  });

  it("indemnity above the cost leaves nothing deductible, never a negative amount", () => {
    // 15,000/mo indemnity vs a 10,000/mo cost: 2055 = 9 × 15,000 = 135,000 > 120,000.
    const { data } = applyLtcEvent(plan({ policies: [traditional({ benefitAmount: 15_000, benefitType: "indemnity", benefitPeriodMode: "lifetime", benefitPeriodYears: null })] }));
    expect(careRow(data).medicalDeductibleByYear).toEqual({ 2055: 0, 2056: 0, 2057: 0 });
  });

  it("waives the insured's premium from the year care starts and leaves the co-client's alone", () => {
    const expenses = [...sampleExpenses, premium("trad", 2026, 2065), premium("jane", 2026, 2067)];
    const { data } = applyLtcEvent(plan({ policies: [traditional(), traditional({ id: "jane", insured: "spouse" })], expenses }));
    expect(data.expenses.find((e) => e.id === ltcPremiumExpenseId("trad"))!.endYear).toBe(2054); // care starts 2055
    expect(data.expenses.find((e) => e.id === ltcPremiumExpenseId("jane"))!.endYear).toBe(2067); // Jane isn't in care
  });

  it("a policy issued after care began pays from its issue year, and its premium is waived", () => {
    const expenses = [...sampleExpenses, premium("late", 2056, 2065)];
    const { data } = applyLtcEvent(plan({ policies: [traditional({ id: "late", issueYear: 2056 })], expenses }));
    // Wait counted from Jan 2056: 9 × 6,000 = 54,000, then 72,000.
    expect(data.incomes.find((i) => i.id === ltcBenefitIncomeId("late"))!.scheduleOverrides).toEqual({ 2056: 54_000, 2057: 72_000 });
    expect(data.expenses.some((e) => e.id === ltcPremiumExpenseId("late"))).toBe(false); // bills from 2056, waived from 2055
  });

  it("'Include LTC policies' off: no benefits, no rider draws, no LTC premiums, full cost deductible", () => {
    const expenses = [...sampleExpenses, premium("trad", 2026, 2065), premium("jane", 2026, 2067)];
    const { data, resolution } = applyLtcEvent(plan({
      includePolicies: false, expenses,
      policies: [traditional(), traditional({ id: "jane", insured: "spouse" }), rider()],
      accounts: [...sampleAccounts, checking, wholeLife],
    }));
    expect(data.incomes.some((i) => i.sourceLtcPolicyId)).toBe(false);
    expect(data.expenses.some((e) => e.id.startsWith("ltc-premium-"))).toBe(false);
    expect(data.accounts.find((a) => a.id === "life-1")!.lifeInsurance!.ltcAcceleration).toBeUndefined();
    expect(careRow(data).medicalDeductibleByYear).toEqual({ 2055: 120_000, 2056: 120_000, 2057: 120_000 });
    expect(resolution!.coverage).toMatchObject({ includePolicies: false, people: [{ totalCost: 360_000, totalCovered: 0, policies: [] }] });
  });

  it("a rider's draws land on its own copy of the life policy", () => {
    const input = plan({ policies: [rider()], accounts: [...sampleAccounts, checking, wholeLife] });
    const { data } = applyLtcEvent(input);
    // 2% × 500,000 = 10,000/mo = the whole cost: 120,000 a year.
    expect(data.accounts.find((a) => a.id === "life-1")!.lifeInsurance!.ltcAcceleration).toEqual({
      byYear: { 2055: 120_000, 2056: 120_000, 2057: 120_000 }, minimumDeathBenefit: 0,
    });
    expect(input.accounts.find((a) => a.id === "life-1")!.lifeInsurance!.ltcAcceleration).toBeUndefined();
  });

  it("a rider whose life policy starts after care began draws from that year", () => {
    const { data } = applyLtcEvent(plan({ policies: [rider()], accounts: [...sampleAccounts, checking, { ...wholeLife, activationYear: 2056 }] }));
    // Nothing in 2055 (not in force yet); then 2% × 500,000 = 10,000/mo = 120,000 a year.
    expect(data.accounts.find((a) => a.id === "life-1")!.lifeInsurance!.ltcAcceleration!.byYear).toEqual({ 2056: 120_000, 2057: 120_000 });
  });

  it("a co-client with no life expectancy keeps a shared pool open to 95, as the engine's death rule does", () => {
    // Jane born 1966, no expectancy: the engine has her alive to 1966 + 95 = 2061,
    // not to John's care-shortened 87 (1966 + 87 = 2053, before his care).
    const base = plan({ policies: [
      traditional({ sharedCare: true, benefitPeriodYears: 1 }),
      traditional({ id: "jane", insured: "spouse", sharedCare: true, benefitPeriodYears: 1 }),
    ] });
    const { data } = applyLtcEvent({ ...base, client: { ...base.client, spouseDob: "1966-01-01", spouseLifeExpectancy: null } });
    // Each pool = 6,000 × 12 × 1 = 72,000 (12 months). John's own: Apr 2055 – Mar 2056
    // (2055: 9 × 6,000 = 54,000). Jane's: Apr 2056 – Mar 2057. 2056 = 3 × 6,000 + 9 × 6,000
    // = 72,000; 2057 = 3 × 6,000 = 18,000, then both pools are spent.
    expect(data.incomes.find((i) => i.id === ltcBenefitIncomeId("trad"))!.scheduleOverrides).toEqual({
      2055: 54_000, 2056: 72_000, 2057: 18_000,
    });
  });

  it("warns, and pays nothing, for a rider whose life policy isn't in the plan", () => {
    const { data, resolution } = applyLtcEvent(plan({ policies: [rider({ lifePolicyAccountId: "gone" })] }));
    expect(resolution!.warnings).toContainEqual({ kind: "rider_life_policy_missing", policyId: "rider", policyName: "Whole life rider" });
    expect(data.incomes.some((i) => i.sourceLtcPolicyId)).toBe(false);
  });

  it("reports coverage over the whole care period", () => {
    const { resolution } = applyLtcEvent(plan({ policies: [traditional()] }));
    expect(resolution!.coverage).toMatchObject({
      includePolicies: true,
      people: [{
        person: "client", startYear: 2055, endYear: 2057,
        totalCost: 360_000, // 3 × 120,000
        totalCovered: 198_000, // 54,000 + 72,000 + 72,000
        policies: [{ policyId: "trad", firstYear: 2055, monthlyLimit: 6000, total: 198_000 }],
      }],
    });
  });

  it("with no policies on file it applies exactly what Phase 1 did", () => {
    const input = plan();
    const { data } = applyLtcEvent(input);
    expect(data.incomes).toBe(input.incomes);
    expect(data.accounts).toBe(input.accounts);
    expect(careRow(data).medicalDeductibleByYear).toEqual({ 2055: 120_000, 2056: 120_000, 2057: 120_000 });
  });

  it("is pure with policies and a rider", () => {
    const input = plan({
      policies: [traditional(), rider()],
      accounts: [...sampleAccounts, checking, wholeLife],
      expenses: [...sampleExpenses, premium("trad", 2026, 2065)],
    });
    const before = JSON.stringify(input);
    const first = runProjection(input);
    const second = runProjection(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("LTC policies through runProjection", () => {
  it("the rider's draws come off the death benefit John's heirs receive", () => {
    const accounts = [...sampleAccounts, checking, wholeLife];
    const year = (d: ClientData) => runProjection(d).find((y) => y.year === 2057)!; // John dies at the end of care
    // 500,000 − 3 × 120,000 drawn = 140,000.
    expect(year(plan({ policies: [rider()], accounts })).income.bySource["life-insurance-proceeds:life-1"]).toBeCloseTo(140_000, 2);
    expect(year(plan({ policies: [rider()], accounts, includePolicies: false })).income.bySource["life-insurance-proceeds:life-1"]).toBe(500_000);
  });

  it("an insured household ends care with materially more than an uninsured one", () => {
    const insured = runProjection(plan({ policies: [traditional()] })).find((y) => y.year === 2057)!;
    const uninsured = runProjection(plan({ policies: [traditional()], includePolicies: false })).find((y) => y.year === 2057)!;
    expect(insured.income.bySource[ltcBenefitIncomeId("trad")]).toBe(72_000);
    // 198,000 of tax-free benefits replace portfolio draws the uninsured plan
    // must make (and pay tax on). The gap is at least three-quarters of that.
    expect(insured.portfolioAssets.liquidTotal - uninsured.portfolioAssets.liquidTotal).toBeGreaterThan(150_000);
  });
});
