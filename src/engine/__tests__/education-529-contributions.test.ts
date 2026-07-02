import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Income, SavingsRule } from "../types";

/**
 * Task 4 — external-grantor 529 contributions bypass household cash.
 *
 * A 529 funded by an OUTSIDE grantor (education529.grantorFamilyMemberId is
 * null/undefined — e.g. a grandparent) still receives its savings-rule
 * contribution as an account credit, but household checking is NOT debited
 * (the money is a gift arriving from outside the plan, same shape as an
 * employer match). Household-grantor 529s keep the existing behavior: checking
 * is debited for the contribution.
 *
 * The fixture is deliberately isolated (one salary, default checking, two 529s)
 * so checking only moves for the household-funded contribution.
 */

const checking: Account = {
  id: "chk",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 100000,
  basis: 100000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

// A 529 whose grantor is the household client — checking IS debited.
const hh529: Account = {
  id: "hh-529",
  name: "Household 529",
  category: "education_savings",
  subType: "529",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  education529: { grantorFamilyMemberId: LEGACY_FM_CLIENT, beneficiaryName: "Kid" },
  owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-1", percent: 1 }],
};

// A 529 funded by an outside grantor (grandparent) — checking is NOT debited.
const gp529: Account = {
  id: "gp-529",
  name: "Grandparent 529",
  category: "education_savings",
  subType: "529",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  education529: { grantorName: "Grandma", beneficiaryName: "Kid" },
  owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-2", percent: 1 }],
};

const salary: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Client Salary",
  annualAmount: 150000,
  startYear: 2026,
  endYear: 2026,
  growthRate: 0,
  owner: "client",
};

const savingsRule = (id: string, accountId: string): SavingsRule => ({
  id,
  accountId,
  annualAmount: 10000,
  isDeductible: false,
  startYear: 2026,
  endYear: 2026,
});

function makeData() {
  const base = buildClientData({
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
  });
  return {
    ...base,
    accounts: [checking, hh529, gp529],
    incomes: [salary],
    expenses: [],
    liabilities: [],
    savingsRules: [savingsRule("sav-hh", "hh-529"), savingsRule("sav-gp", "gp-529")],
    withdrawalStrategy: [],
  };
}

describe("external-grantor 529 contributions", () => {
  it("credits both 529s but only debits checking for the household-funded one", () => {
    const y = runProjection(makeData())[0];

    // Both accounts received their contribution:
    expect(y.savings.byAccount["hh-529"]).toBe(10_000);
    expect(y.savings.byAccount["gp-529"]).toBe(10_000);
    expect(y.accountLedgers["hh-529"].endingValue).toBeCloseTo(10_000, 6);
    expect(y.accountLedgers["gp-529"].endingValue).toBeCloseTo(10_000, 6);

    // Checking ledger shows a savings_contribution debit of ONLY the
    // household-funded 10k — the grandparent gift never touches household cash.
    const checkingEntries = y.accountLedgers["chk"].entries.filter(
      (e) => e.category === "savings_contribution",
    );
    expect(checkingEntries.reduce((s, e) => s + e.amount, 0)).toBe(-10_000);

    // The external-grantor credit carries no household-checking counterparty.
    const gpEntry = y.accountLedgers["gp-529"].entries.find(
      (e) => e.category === "savings_contribution",
    );
    expect(gpEntry?.counterpartyId).toBeUndefined();
    const hhEntry = y.accountLedgers["hh-529"].entries.find(
      (e) => e.category === "savings_contribution",
    );
    expect(hhEntry?.counterpartyId).toBe("chk");
  });
});
