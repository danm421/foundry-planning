import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, baseClient, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, FamilyMember } from "../types";

// R4 (education dedicated-funding tax-free slice). The supplemental-withdrawal
// site surfaces the untaxed retirement slice of a Roth/HSA draw as non-taxable
// income (taxFreeRetirementSlice → taxFreeRetirementIncome + a
// `withdrawal_tax_free:*` bySource row). The education dedicated-funding pass —
// a second categorizeDraw consumer — never did, so a Roth/HSA named as an
// education funding source had its tax-free portion vanish from
// nonTaxableIncome AND the tax ledger. Both consumers must surface the slice.

const BIRTH_YEAR = 1964; // age 62 in 2026 → post-59.5, qualified Roth distribution

const soloClient: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Solo",
    lastName: "Test",
    dateOfBirth: `${BIRTH_YEAR}-01-01`,
  },
];

const checking: Account = {
  id: "chk", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros",
  value: 100_000, basis: 100_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

// Roth IRA funding an education goal. Post-59.5 → the whole $20k draw is a
// qualified (tax-free) distribution: ordinaryIncome 0, tax-free slice $20k.
const eduRoth: Account = {
  id: "edu-roth", name: "Roth IRA (education)", category: "retirement", subType: "roth_ira",
  titlingType: "jtwros",
  value: 30_000, basis: 20_000, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const eduExpense: Expense = {
  id: "edu", type: "education", name: "College", annualAmount: 20_000,
  startYear: 2026, endYear: 2026, growthRate: 0,
  dedicatedAccountIds: ["edu-roth"], payShortfallOutOfPocket: false,
};

function runYearOne() {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: `${BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, eduRoth],
    incomes: [], expenses: [eduExpense], liabilities: [], savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027 },
  });
  return runProjection(data)[0];
}

describe("education dedicated funding — tax-free retirement slice (R4)", () => {
  it("surfaces a Roth education draw's tax-free slice as non-taxable income + a ledger row", () => {
    const y0 = runYearOne();

    // Qualified Roth draw → no taxable education row.
    expect(y0.taxDetail!.bySource["education:edu"]).toBeUndefined();
    // The $20k tax-free slice appears as a non-taxable ledger row...
    expect(y0.taxDetail!.bySource["education_tax_free:edu"]).toEqual({
      type: "tax_free",
      amount: 20_000,
    });
    // ...and reaches the income totals (no SS / tax-exempt / supplemental draws,
    // so nonTaxableIncome is exactly the education tax-free slice).
    expect(y0.taxResult!.income.nonTaxableIncome).toBeCloseTo(20_000, 6);
  });
});
