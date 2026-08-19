import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData, Expense, FamilyMember, Income, WithdrawalPriority } from "../types";

const FIRST_YEAR = 2026;
const LAST_YEAR = 2027;

const checking: Account = {
  id: "acct-checking", name: "Joint Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 10_000, basis: 10_000, growthRate: 0, rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const brokerage: Account = {
  id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
  titlingType: "jtwros", value: 500_000, basis: 500_000, growthRate: 0, rmdEnabled: false,
  isDefaultChecking: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const salary: Income = {
  id: "inc-salary", type: "salary", name: "Salary", annualAmount: 200_000,
  startYear: FIRST_YEAR, endYear: LAST_YEAR, growthRate: 0, owner: "client",
};

const other: Expense = {
  id: "exp-other", type: "other", name: "Fixed costs", annualAmount: 120_000,
  startYear: FIRST_YEAR, endYear: LAST_YEAR, growthRate: 0,
};

const soloFamily: FamilyMember[] = [{
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "John", lastName: "Smith", dateOfBirth: "1980-01-01",
}];

const withdrawalStrategy: WithdrawalPriority[] = [
  { accountId: "acct-checking", priorityOrder: 1, startYear: FIRST_YEAR, endYear: LAST_YEAR },
  { accountId: "acct-brokerage", priorityOrder: 2, startYear: FIRST_YEAR, endYear: LAST_YEAR },
];

function livingRow(over: Partial<Expense>): Expense {
  return {
    id: "exp-living", type: "living", name: "Current Living Expenses",
    annualAmount: 0, startYear: FIRST_YEAR, endYear: LAST_YEAR, growthRate: 0,
    ...over,
  };
}

function fixture(living: Expense): ClientData {
  return buildClientData({
    client: {
      ...baseClient, dateOfBirth: "1980-01-01", retirementAge: 70, planEndAge: 90,
      filingStatus: "single", spouseName: undefined, spouseDob: undefined,
      spouseRetirementAge: undefined,
    },
    familyMembers: soloFamily,
    accounts: [checking, brokerage],
    incomes: [salary],
    expenses: [living, other],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy,
    planSettings: {
      ...basePlanSettings,
      // Zero taxes + inflation so leftover is exactly 200k − 120k = 80k/yr.
      flatFederalRate: 0, flatStateRate: 0, inflationRate: 0,
      planStartYear: FIRST_YEAR, planEndYear: LAST_YEAR,
      surplusSpendPct: 0.5,
      surplusSaveAccountId: "acct-brokerage",
      surplusSpendAllUntilRetirement: false,
    },
  });
}

describe("living expense absorbs remaining cash flow", () => {
  it("spends the whole leftover as living expense, not as discretionary", () => {
    const y = runProjection(fixture(livingRow({ absorbsRemainingCashFlow: true })))[0];
    expect(y.expenses.living).toBeCloseTo(80_000, 0);
    expect(y.expenses.discretionary).toBeCloseTo(0, 0);
    expect(y.netCashFlow).toBeCloseTo(0, 0);
  });

  it("attributes the absorbed spend to the row's own id in bySource", () => {
    const y = runProjection(fixture(livingRow({ absorbsRemainingCashFlow: true })))[0];
    expect(y.expenses.bySource["exp-living"]).toBeCloseTo(80_000, 0);
  });

  it("sends nothing to the save-remainder destination", () => {
    const y = runProjection(fixture(livingRow({ absorbsRemainingCashFlow: true })))[0];
    // Brokerage opens at 500k with zero growth and must not receive the
    // 50% that surplusSpendPct would otherwise have transferred.
    expect(y.accountLedgers["acct-brokerage"].endingValue).toBeCloseTo(500_000, 0);
  });

  it("holds the floor when leftover cash falls short of it", () => {
    // Floor 100k against only 80k of leftover: the row still spends 100k and
    // the withdrawal waterfall covers the 20k gap.
    const y = runProjection(fixture(livingRow({
      absorbsRemainingCashFlow: true, annualAmount: 100_000,
    })))[0];
    expect(y.expenses.living).toBeCloseTo(100_000, 0);
    expect(y.withdrawals.total).toBeGreaterThan(0);
  });

  it("exceeds the floor without double-booking it", () => {
    // Floor 30k, 80k available before living. Leftover after the floor is 50k,
    // so the row spends 30k + 50k = 80k — NOT 30k + 80k.
    const y = runProjection(fixture(livingRow({
      absorbsRemainingCashFlow: true, annualAmount: 30_000,
    })))[0];
    expect(y.expenses.living).toBeCloseTo(80_000, 0);
  });

  it("absorbs only in years the row's window includes", () => {
    const y = runProjection(fixture(livingRow({
      absorbsRemainingCashFlow: true, endYear: FIRST_YEAR,
    })))[1];
    expect(y.year).toBe(LAST_YEAR);
    // Row inactive → the normal 50/50 split resumes.
    expect(y.expenses.discretionary).toBeCloseTo(40_000, 0);
  });

  it("changes nothing when the flag is off", () => {
    const y = runProjection(fixture(livingRow({})))[0];
    expect(y.expenses.discretionary).toBeCloseTo(40_000, 0);
    expect(y.expenses.living).toBeCloseTo(0, 0);
  });
});
