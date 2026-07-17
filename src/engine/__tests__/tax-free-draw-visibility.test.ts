import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, FamilyMember, WithdrawalPriority } from "../types";

// F3 (tax-ledger alignment): tax-free retirement draw slices — Roth IRA draws,
// the Roth slice of 401(k)/403(b) draws, HSA draws — must surface as
// non-taxable income instead of vanishing from both the income-tax report and
// the tax ledger. Return-of-basis on taxable-account draws is deliberately
// excluded: that is principal, not income.

const soloClient: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Solo",
    lastName: "Test",
    dateOfBirth: "1960-01-01", // age 66 in 2026 — post-59.5, pre-RMD
  },
];

const checking: Account = {
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros",
  value: 5000, basis: 5000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const livingExpense: Expense = {
  id: "exp-living", name: "Living", type: "living",
  annualAmount: 80000, growthRate: 0, startYear: 2026, endYear: 2027,
};

function strategy(accountId: string): WithdrawalPriority[] {
  return [{ accountId, priorityOrder: 1, startYear: 2026, endYear: 2027 }];
}

function runYearOne(acct: Account) {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01", spouseName: undefined, spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, acct],
    incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
    withdrawalStrategy: strategy(acct.id),
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027, taxEngineMode: "bracket" },
    taxYearRows: [TAX_YEAR_2026],
  });
  return runProjection(data)[0];
}

describe("tax-free retirement draws surface as non-taxable income", () => {
  it("a qualified Roth IRA draw lands in nonTaxableIncome and bySource", () => {
    const year = runYearOne({
      id: "acct-roth", name: "Roth IRA", category: "retirement", subType: "roth_ira",
      titlingType: "jtwros",
      value: 500000, basis: 100000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    });

    const drawn = year.withdrawals.byAccount["acct-roth"] ?? 0;
    expect(drawn).toBeGreaterThan(0);

    const entry = year.taxDetail!.bySource["withdrawal_tax_free:acct-roth"];
    expect(entry).toBeDefined();
    expect(entry.type).toBe("tax_free");
    expect(entry.amount).toBeCloseTo(drawn, 4);

    // No other income, no SS, no munis → the whole non-taxable bucket is the draw.
    expect(year.taxResult!.income.nonTaxableIncome).toBeCloseTo(drawn, 4);
    expect(year.taxResult!.income.grossTotalIncome).toBeCloseTo(
      year.taxResult!.income.totalIncome + drawn, 4,
    );
  });

  it("only the Roth slice of a mixed 401(k) draw is non-taxable", () => {
    const year = runYearOne({
      id: "acct-401k", name: "Mixed 401(k)", category: "retirement", subType: "401k",
      titlingType: "jtwros",
      value: 1_000_000, basis: 0, rothValue: 400_000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    });

    const drawn = year.withdrawals.byAccount["acct-401k"] ?? 0;
    expect(drawn).toBeGreaterThan(0);

    const taxable = year.taxDetail!.bySource["withdrawal:acct-401k"];
    const taxFree = year.taxDetail!.bySource["withdrawal_tax_free:acct-401k"];
    expect(taxable.amount).toBeCloseTo(drawn * 0.6, 4);
    expect(taxFree.type).toBe("tax_free");
    expect(taxFree.amount).toBeCloseTo(drawn * 0.4, 4);
    expect(year.taxResult!.income.nonTaxableIncome).toBeCloseTo(drawn * 0.4, 4);
  });

  it("a traditional IRA draw produces no tax-free entry", () => {
    const year = runYearOne({
      id: "acct-ira", name: "Trad IRA", category: "retirement", subType: "traditional_ira",
      titlingType: "jtwros",
      value: 500000, basis: 0, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    });

    expect(year.withdrawals.byAccount["acct-ira"] ?? 0).toBeGreaterThan(0);
    expect(year.taxDetail!.bySource["withdrawal_tax_free:acct-ira"]).toBeUndefined();
    expect(year.taxResult!.income.nonTaxableIncome).toBe(0);
  });
});
