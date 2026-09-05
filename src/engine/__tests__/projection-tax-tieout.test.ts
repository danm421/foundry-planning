import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, FamilyMember, WithdrawalPriority } from "../types";
import type { TaxAdjustmentRow } from "../tax-adjustments";

// C2 cross-report tie-out: the cash-flow "Taxes" line (expenses.taxes) must
// equal the income-tax report "Total Tax" (taxResult.flow.totalTax) for every
// year — including years where a pre-59½ gap-fill draw levies the 10%
// early-withdrawal penalty. Before the C2 fix, expenses.taxes folded in the
// supplemental penalty while flow.totalTax did not, so the two reports diverged.
//
// EXCEPTION — recorded withholding. The plain equality holds only when nothing
// was withheld, which is why the first fixture below carries no tax
// adjustments. When an adjustment records withholding, the two lines diverge BY
// DESIGN by exactly `flow.taxAlreadyPaid`: withholding is a payment already
// made, so the cash flow must not withdraw it a second time, while
// `flow.totalTax` stays the full, honest liability. The general invariant this
// file guards is therefore
//
//     expenses.taxes == flow.totalTax − flow.taxAlreadyPaid
//
// which reduces to the plain equality at zero withholding. Both arms are
// asserted below — do NOT "fix" the divergence back out.

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

  // The other arm of the invariant. The plain equality above is FALSE here by
  // design, so this case asserts the general form and pins the size of the gap
  // to the withheld amount — a divergence of any other size is a bug.
  it("diverges by exactly taxAlreadyPaid when an adjustment records withholding", () => {
    const withheld: TaxAdjustmentRow = {
      id: "adj-tieout",
      taxType: "ordinary_income",
      name: "Roth conversion, tax withheld at the custodian",
      annualAmount: 50_000,
      growthRate: 0,
      startYear: 2026,
      endYear: 2028,
      withheldMode: "amount",
      withheldValue: 4_000,
    };
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1980-01-01", spouseDob: undefined },
      familyMembers: buildSinglePersonClient(1980),
      accounts: [checking, tradIra],
      incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
      withdrawalStrategy: strategy("acct-ira"),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2028 },
      taxAdjustments: [withheld],
    });
    const years = runProjection(data);

    for (const py of years) {
      const flow = py.taxResult!.flow;
      expect(py.expenses.taxes).toBeCloseTo(flow.totalTax - flow.taxAlreadyPaid, 6);
      // The liability itself is never reduced by a payment.
      expect(flow.totalTax).toBeGreaterThan(flow.balanceDue);
    }
    // The gap is real and is the withheld amount, not an accident of rounding:
    // without this, a change that zeroed `taxAlreadyPaid` would still pass the
    // loop above.
    expect(years.every((y) => y.taxResult!.flow.taxAlreadyPaid === 4_000)).toBe(true);
    expect(
      years.every(
        (y) => y.taxResult!.flow.balanceDue === y.taxResult!.flow.totalTax - 4_000,
      ),
    ).toBe(true);
  });
});
