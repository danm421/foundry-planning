import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData, Expense, FamilyMember, Income, WithdrawalPriority } from "../types";

// Two-year window straddling retirement. Client born 1980, retiring at 47 →
// first retirement year 2027. 2026 is a working year; 2027 is not.
const FIRST_YEAR = 2026;
const RETIREMENT_YEAR = 2027;

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
  startYear: FIRST_YEAR,
  endYear: RETIREMENT_YEAR,
  growthRate: 0,
  owner: "client",
};

const living: Expense = {
  id: "exp-living",
  type: "living",
  name: "Living",
  annualAmount: 60_000,
  startYear: FIRST_YEAR,
  endYear: RETIREMENT_YEAR,
  growthRate: 0,
};

const soloFamily: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1980-01-01",
  },
];

const withdrawalStrategy: WithdrawalPriority[] = [
  { accountId: "acct-checking", priorityOrder: 1, startYear: FIRST_YEAR, endYear: RETIREMENT_YEAR },
  { accountId: "acct-brokerage", priorityOrder: 2, startYear: FIRST_YEAR, endYear: RETIREMENT_YEAR },
];

function fixture(spendAllUntilRetirement: boolean): ClientData {
  return buildClientData({
    client: {
      ...baseClient,
      dateOfBirth: "1980-01-01",
      retirementAge: 47, // → first retirement year 2027
      planEndAge: 90,
      filingStatus: "single",
      spouseName: undefined,
      spouseDob: undefined,
      spouseRetirementAge: undefined,
    },
    familyMembers: soloFamily,
    accounts: [checking, brokerage],
    incomes: [salary],
    expenses: [living],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy,
    planSettings: {
      ...basePlanSettings,
      // Zero taxes + inflation so the surplus math is exact: 100k − 60k = 40k/yr.
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: FIRST_YEAR,
      planEndYear: RETIREMENT_YEAR,
      surplusSpendPct: 0.5,
      surplusSaveAccountId: "acct-brokerage",
      surplusSpendAllUntilRetirement: spendAllUntilRetirement,
    },
  });
}

describe("surplusSpendAllUntilRetirement", () => {
  it("spends the entire surplus in a pre-retirement year", () => {
    const y = runProjection(fixture(true))[0];
    expect(y.year).toBe(FIRST_YEAR);
    // Surplus = 100k − 60k = 40k, all of it discretionary despite spendPct 0.5.
    expect(y.expenses.discretionary).toBeCloseTo(40_000, 0);
    // Nothing transferred to the save destination.
    expect(y.accountLedgers["acct-brokerage"].endingValue).toBeCloseTo(0, 0);
    // Checking keeps only its opening balance.
    expect(y.accountLedgers["acct-checking"].endingValue).toBeCloseTo(10_000, 0);
  });

  it("reverts to the stored pct in the retirement year itself", () => {
    const y = runProjection(fixture(true))[1];
    expect(y.year).toBe(RETIREMENT_YEAR);
    // 40k surplus, 50% spent, 50% transferred to the brokerage.
    expect(y.expenses.discretionary).toBeCloseTo(20_000, 0);
    expect(y.accountLedgers["acct-brokerage"].endingValue).toBeCloseTo(20_000, 0);
  });

  it("changes nothing when the flag is off", () => {
    const years = runProjection(fixture(false));
    // Both years split 50/50 — 20k spent, 20k transferred, brokerage accrues 40k.
    expect(years[0].expenses.discretionary).toBeCloseTo(20_000, 0);
    expect(years[1].expenses.discretionary).toBeCloseTo(20_000, 0);
    expect(years[1].accountLedgers["acct-brokerage"].endingValue).toBeCloseTo(40_000, 0);
  });
});
