import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, FamilyMember, WithdrawalPriority } from "../types";

// Pre-59.5 client with a household cash deficit fed exclusively from a
// Traditional IRA via the gap-fill path. The 10% early-withdrawal penalty
// must show up in expenses.taxes for the year.
//
// Bug being fixed: computeWithdrawalPenalty existed in withdrawal.ts but was
// never wired into the projection's supplemental-withdrawal block, so
// pre-59.5 deficit-driven Trad-IRA draws owed nothing extra in the model.

function buildSinglePersonClient(birthYear: number): FamilyMember[] {
  return [{
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Solo",
    lastName: "Test",
    dateOfBirth: `${birthYear}-01-01`,
  }];
}

const checking: Account = {
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  value: 5000, basis: 5000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const tradIra: Account = {
  id: "acct-ira", name: "Trad IRA", category: "retirement", subType: "traditional_ira",
  value: 500000, basis: 0, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const rothIra: Account = {
  id: "acct-roth", name: "Roth IRA", category: "retirement", subType: "roth_ira",
  value: 200000, basis: 200000, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const livingExpense: Expense = {
  id: "exp-living", name: "Living", type: "living",
  annualAmount: 80000, growthRate: 0, startYear: 2026, endYear: 2026,
};

function strategy(firstAccountId: string): WithdrawalPriority[] {
  return [
    { accountId: firstAccountId, priorityOrder: 1, startYear: 2026, endYear: 2026 },
  ];
}

describe("F3: supplemental withdrawal applies 10% early-withdrawal penalty", () => {
  it("levies 10% on a pre-59.5 Trad-IRA gap-fill draw", () => {
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1980-01-01", spouseDob: undefined },
      familyMembers: buildSinglePersonClient(1980), // age 46 in 2026
      accounts: [checking, tradIra],
      incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
      withdrawalStrategy: strategy("acct-ira"),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection(data);
    const year = years[0];

    // Sanity: the engine actually pulled from the IRA via the gap-fill.
    const iraDraw = year.withdrawals.byAccount["acct-ira"] ?? 0;
    expect(iraDraw).toBeGreaterThan(0);

    // expenses.taxes must include marginal tax + 10% penalty on the IRA draw.
    // basePlanSettings: 22% federal + 5% state = 27% marginal. With penalty
    // the floor is 37%. A pure marginal-only (buggy) result would be ~27%.
    // This bound sits between 27% and 37% to distinguish penalty-present from
    // penalty-absent.
    expect(year.expenses.taxes).toBeGreaterThanOrEqual(iraDraw * 0.36);
  });

  it("does NOT levy a penalty post-59.5", () => {
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: undefined },
      familyMembers: buildSinglePersonClient(1960), // age 66 in 2026
      accounts: [checking, tradIra],
      incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
      withdrawalStrategy: strategy("acct-ira"),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection(data);
    const year = years[0];
    const iraDraw = year.withdrawals.byAccount["acct-ira"] ?? 0;
    expect(iraDraw).toBeGreaterThan(0);
    // Post-59.5: expenses.taxes is marginal tax only — no 10% adder. Use a
    // generous upper bound that is still safely below "marginal + penalty"
    // for reasonable bracket choices (basePlanSettings has 22% federal + 5%
    // state ≈ 27% marginal; with penalty the floor would be ~37%).
    expect(year.expenses.taxes).toBeLessThan(iraDraw * 0.34);
  });

  it("does NOT levy a penalty on a Roth gap-fill within source basis", () => {
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1980-01-01", spouseDob: undefined },
      familyMembers: buildSinglePersonClient(1980), // pre-59.5
      accounts: [checking, rothIra],
      incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
      withdrawalStrategy: strategy("acct-roth"),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection(data);
    const year = years[0];
    const rothDraw = year.withdrawals.byAccount["acct-roth"] ?? 0;
    expect(rothDraw).toBeGreaterThan(0);
    // Roth basis ($200k) ≫ draw, so contributions cover it: no taxable
    // earnings, no 10% penalty. The supplemental gross-up still applies
    // marginalRate (27%) to the whole draw; the test only checks that the
    // 10% penalty is NOT added on top (bound sits between 27% and 37%).
    expect(year.expenses.taxes).toBeLessThan(rothDraw * 0.34);
  });
});
