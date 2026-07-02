import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense } from "../types";

/**
 * Task 7 — pin test. `applyEducationFunding` (projection.ts) and
 * `categorizeDraw` (withdrawal.ts) key off `subType === "529"`, not
 * `category`, so a dedicated account filed under the new `education_savings`
 * category should draw identically to a legacy 529-filed-as-taxable account:
 * tax-free, and decrementing the dedicated balance. This test exists to catch
 * a regression if a future change adds a category filter to the education
 * pass that excludes `education_savings`.
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

const educationSavings529: Account = {
  id: "es529",
  name: "529 College Fund",
  category: "education_savings",
  subType: "529",
  titlingType: "jtwros",
  value: 30000,
  basis: 30000,
  growthRate: 0,
  rmdEnabled: false,
  education529: { grantorFamilyMemberId: LEGACY_FM_CLIENT, beneficiaryFamilyMemberId: "kid-1", beneficiaryName: "Kid" },
  owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-1", percent: 1 }],
};

const eduExpense: Expense = {
  id: "edu",
  type: "education",
  name: "College",
  annualAmount: 20000,
  startYear: 2026,
  endYear: 2026,
  growthRate: 0,
  dedicatedAccountIds: [educationSavings529.id],
  payShortfallOutOfPocket: false,
};

describe("applyEducationFunding — education_savings category", () => {
  it("draws a dedicated education_savings 529 tax-free and decrements its balance", () => {
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const data = {
      ...base,
      accounts: [checking, educationSavings529],
      incomes: [],
      expenses: [eduExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
    };

    const years = runProjection(data);
    const y0 = years[0];

    const goal = y0.educationGoals?.find((g) => g.goalId === "edu");
    expect(goal).toBeDefined();
    expect(goal!.dedicatedAssetsBOY).toBe(30000);
    expect(goal!.goalExpense).toBe(20000);
    expect(goal!.dedicatedWithdrawal).toBe(20000);
    expect(goal!.shortfall).toBe(0);
    expect(goal!.dedicatedAssetsEOY).toBeCloseTo(10000, 6);

    // 529 draw is tax-free: no ordinary income / capital gains booked under
    // the goal source.
    const taxSource = y0.taxDetail!.bySource["education:edu"];
    expect(taxSource).toBeUndefined();

    // The 529 balance dropped by exactly the draw; checking is untouched.
    expect(y0.accountLedgers["es529"].endingValue).toBeCloseTo(10000, 6);
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(100000, 6);
  });
});
