import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, FamilyMember, WithdrawalPriority } from "../types";

// C2 cross-report tie-out: the cash-flow "Taxes" line (expenses.taxes) must
// equal the income-tax report "Total Tax" (taxResult.flow.totalTax) for every
// year — including years where a pre-59½ gap-fill draw levies the 10%
// early-withdrawal penalty. Before the C2 fix, expenses.taxes folded in the
// supplemental penalty while flow.totalTax did not, so the two reports diverged.

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
  titlingType: "jtwros",
  value: 5000, basis: 5000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const tradIra: Account = {
  id: "acct-ira", name: "Trad IRA", category: "retirement", subType: "traditional_ira",
  titlingType: "jtwros",
  value: 500000, basis: 0, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const livingExpense: Expense = {
  id: "exp-living", name: "Living", type: "living",
  annualAmount: 80000, growthRate: 0, startYear: 2026, endYear: 2028,
};

function strategy(firstAccountId: string): WithdrawalPriority[] {
  return [
    { accountId: firstAccountId, priorityOrder: 1, startYear: 2026, endYear: 2028 },
  ];
}

describe("C2: cash-flow Taxes == income-tax Total Tax (gap-fill penalty folded in)", () => {
  it("expenses.taxes equals flow.totalTax in every year, with a penalty year present", () => {
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1980-01-01", spouseDob: undefined },
      familyMembers: buildSinglePersonClient(1980), // age 46 in 2026 → pre-59½
      accounts: [checking, tradIra],
      incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
      withdrawalStrategy: strategy("acct-ira"),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2028 },
    });
    const years = runProjection(data);

    for (const py of years) {
      expect(py.expenses.taxes).toBeCloseTo(py.taxResult!.flow.totalTax, 6);
    }
    // and at least one year actually exercised the penalty:
    expect(
      years.some((y) => (y.taxResult!.flow.earlyWithdrawalPenalty ?? 0) > 0),
    ).toBe(true);
  });
});
