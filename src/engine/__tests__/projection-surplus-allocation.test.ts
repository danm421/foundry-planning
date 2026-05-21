import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type {
  Account,
  ClientData,
  Expense,
  FamilyMember,
  Income,
  WithdrawalPriority,
} from "../types";

// Regression test for the planned `surplusSpendPct` / `surplusSaveAccountId`
// allocation step (step 10c). This test locks in the *baseline* behavior — at
// `surplusSpendPct: 0` (the default), no discretionary expense is recorded and
// all surplus stays in the household default checking account, matching today's
// (pre-step-10c) behavior. The two assertions below are the contract that
// Task 3's engine change must preserve.

const PLAN_YEAR = 2026;

const checking: Account = {
  id: "acct-checking",
  name: "Joint Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 10_000,
  basis: 10_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const brokerage: Account = {
  id: "acct-brokerage",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const salary: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Salary",
  annualAmount: 100_000,
  startYear: PLAN_YEAR,
  endYear: PLAN_YEAR,
  growthRate: 0,
  owner: "client",
};

const living: Expense = {
  id: "exp-living",
  type: "living",
  name: "Living",
  annualAmount: 60_000,
  startYear: PLAN_YEAR,
  endYear: PLAN_YEAR,
  growthRate: 0,
};

const soloFamily: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
  },
];

const withdrawalStrategy: WithdrawalPriority[] = [
  { accountId: "acct-checking", priorityOrder: 1, startYear: PLAN_YEAR, endYear: PLAN_YEAR },
  { accountId: "acct-brokerage", priorityOrder: 2, startYear: PLAN_YEAR, endYear: PLAN_YEAR },
];

function baseFixture(overrides?: {
  surplusSpendPct?: number;
  surplusSaveAccountId?: string | null;
  livingAmount?: number;
}): ClientData {
  const livingExpense: Expense = {
    ...living,
    annualAmount: overrides?.livingAmount ?? living.annualAmount,
  };
  return buildClientData({
    // Single-filer household — drop the spouse fields from baseClient.
    client: {
      ...baseClient,
      dateOfBirth: "1980-01-01",
      retirementAge: 65,
      planEndAge: 90,
      filingStatus: "single",
      spouseName: undefined,
      spouseDob: undefined,
      spouseRetirementAge: undefined,
    },
    familyMembers: soloFamily,
    accounts: [checking, brokerage],
    incomes: [salary],
    expenses: [livingExpense],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy,
    planSettings: {
      ...basePlanSettings,
      // Zero out tax + inflation so the cash-flow math is exact and
      // easy to reason about.
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: PLAN_YEAR,
      planEndYear: PLAN_YEAR,
      surplusSpendPct: overrides?.surplusSpendPct,
      surplusSaveAccountId: overrides?.surplusSaveAccountId,
    },
  });
}

describe("surplus cash flow allocation (step 10c)", () => {
  it("0% spend (default): no discretionary, surplus stays in checking", () => {
    const data = baseFixture({ surplusSpendPct: 0 });
    const years = runProjection(data);
    const y = years[0];

    expect(y.expenses.discretionary).toBe(0);
    // Surplus = 100k − 60k = 40k, lands in checking on top of $10k opening balance
    expect(y.accountLedgers["acct-checking"].endingValue).toBeCloseTo(50_000, 0);
  });

  it("50% spend, no destination override: half debited as discretionary, half remains in checking", () => {
    const data = baseFixture({ surplusSpendPct: 0.5 });
    const result = runProjection(data);
    const y = result[0];

    // Surplus = 40k. 50% spent → discretionary = 20k. 50% saved → stays in checking.
    expect(y.expenses.discretionary).toBeCloseTo(20_000, 0);
    // Checking now has: 10k opening + (40k surplus − 20k spent) = 30k
    expect(y.accountLedgers["acct-checking"].endingValue).toBeCloseTo(30_000, 0);
    // Total expenses now includes the discretionary line
    expect(y.expenses.total).toBeCloseTo(60_000 + 20_000, 0);
  });

  it("50% spend with destination override: half spent, half transferred to brokerage", () => {
    const data = baseFixture({ surplusSpendPct: 0.5, surplusSaveAccountId: "acct-brokerage" });
    const result = runProjection(data);
    const y = result[0];

    expect(y.expenses.discretionary).toBeCloseTo(20_000, 0);
    // Checking: 10k opening + (40k − 20k spent − 20k transferred out) = 10k
    expect(y.accountLedgers["acct-checking"].endingValue).toBeCloseTo(10_000, 0);
    // Brokerage: 0 opening + 20k transfer in
    expect(y.accountLedgers["acct-brokerage"].endingValue).toBeCloseTo(20_000, 0);
  });

  it("100% spend: all surplus consumed, no transfer regardless of destination", () => {
    const data = baseFixture({ surplusSpendPct: 1.0, surplusSaveAccountId: "acct-brokerage" });
    const result = runProjection(data);
    const y = result[0];

    expect(y.expenses.discretionary).toBeCloseTo(40_000, 0);
    // Checking: 10k opening + (40k surplus − 40k spent) = 10k
    expect(y.accountLedgers["acct-checking"].endingValue).toBeCloseTo(10_000, 0);
    // Brokerage untouched
    expect(y.accountLedgers["acct-brokerage"].endingValue).toBeCloseTo(0, 0);
  });

  it("destination = same as default checking: no transfer fires", () => {
    const data = baseFixture({ surplusSpendPct: 0.5, surplusSaveAccountId: "acct-checking" });
    const result = runProjection(data);
    const y = result[0];

    expect(y.expenses.discretionary).toBeCloseTo(20_000, 0);
    // Same as no-override case: 10k + 20k saved = 30k
    expect(y.accountLedgers["acct-checking"].endingValue).toBeCloseTo(30_000, 0);
  });

  it("deficit year (surplus ≤ 0): no-op, no discretionary", () => {
    // Expenses (150k) exceed income (100k) — surplusBeforeSavings is negative.
    const data = baseFixture({ surplusSpendPct: 0.5, livingAmount: 150_000 });
    const result = runProjection(data);
    const y = result[0];

    expect(y.expenses.discretionary).toBe(0);
  });
});
