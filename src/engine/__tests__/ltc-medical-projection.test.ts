import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { LEGACY_FM_CLIENT } from "../ownership";
import { buildClientData, baseClient, basePlanSettings, FIXTURE_TAX_PARAMS } from "./fixtures";
import type { Account, ClientData, Income } from "../types";

const ID = "3f1c2d7e-8a1b-4c5d-9e0f-112233445566";
const CARE = 150_000;
const CARE_YEAR = 2027; // Solo 1960 + 67

// Single filer, 66 in 2026, almost no cash: every dollar of care is paid by a
// supplemental Traditional-IRA draw, so the year's AGI (and with it the 7.5%
// floor) depends on the draw that the deduction itself shrinks.
const checking: Account = {
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros",
  value: 5_000, basis: 5_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};
const tradIra: Account = {
  id: "acct-ira", name: "Trad IRA", category: "retirement", subType: "traditional_ira",
  titlingType: "jtwros",
  value: 2_000_000, basis: 0, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

function plan(withCare: boolean, socialSecurity = 0): ClientData {
  const ss: Income = {
    id: "inc-ss", type: "social_security", name: "Solo SS", annualAmount: socialSecurity,
    startYear: 2026, endYear: 2050, growthRate: 0, owner: "client", claimingAge: 62,
  };
  return buildClientData({
    client: {
      ...baseClient, dateOfBirth: "1960-01-01", filingStatus: "single",
      spouseName: undefined, spouseDob: undefined, spouseRetirementAge: undefined, lifeExpectancy: 90,
    },
    familyMembers: [{
      id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
      firstName: "Solo", lastName: "Test", dateOfBirth: "1960-01-01",
    }],
    accounts: [checking, tradIra],
    incomes: socialSecurity > 0 ? [ss] : [],
    expenses: [{
      id: "exp-living", name: "Living", type: "living",
      annualAmount: 40_000, growthRate: 0, startYear: 2026, endYear: 2050,
    }],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [{ accountId: "acct-ira", priorityOrder: 1, startYear: 2026, endYear: 2050 }],
    planSettings: { ...basePlanSettings, planEndYear: 2050, taxEngineMode: "bracket" },
    taxYearRows: FIXTURE_TAX_PARAMS,
    ltcEvents: withCare
      ? [{
          id: ID, name: "LTC", livingExpenseCutPct: null, homeSale: null, includePolicies: true,
          people: [{ person: "client", startAge: 67, years: 2, careSetting: "custom", annualCost: CARE, costInflation: 0 }],
        }]
      : [],
  });
}

describe("medical deduction in the projection", () => {
  it("a care year paid by IRA draws deducts care above 7.5% of that year's final AGI", () => {
    const y = runProjection(plan(true)).find((p) => p.year === CARE_YEAR)!;
    const control = runProjection(plan(false)).find((p) => p.year === CARE_YEAR)!;

    // The care is funded by supplemental IRA draws, not by cash on hand.
    const draw = y.withdrawals.byAccount["acct-ira"] ?? 0;
    expect(draw).toBeGreaterThan((control.withdrawals.byAccount["acct-ira"] ?? 0) + CARE * 0.5);
    // Positive control: without care there is no medical line.
    expect(control.deductionBreakdown!.belowLine.bySource.medical).toBeUndefined();

    // Fixed point: the deduction is floored against the AGI of the SAME pass
    // that produced the stored result, not a pre-withdrawal estimate.
    const agi = y.taxResult!.flow.adjustedGrossIncome;
    expect(agi).toBeGreaterThan(CARE); // the draw is in AGI
    const bd = y.deductionBreakdown!.belowLine;
    expect(Math.abs(bd.bySource.medical.amount - Math.max(0, CARE - 0.075 * agi))).toBeLessThan(5);
    expect(bd.taxDeductions).toBe(bd.itemizedTotal);
  });

  it("the floor counts taxable Social Security, as AGI does", () => {
    // The floor's income base starts from the engine's taxable-income scalar,
    // which carries no Social Security; AGI carries the taxable 85%. Without it
    // the floor here is 7.5% × 34,000 = 2,550 too low.
    const y = runProjection(plan(true, 40_000)).find((p) => p.year === CARE_YEAR)!;
    expect(y.income.socialSecurity).toBe(40_000);
    const agi = y.taxResult!.flow.adjustedGrossIncome;
    const bd = y.deductionBreakdown!.belowLine;
    expect(Math.abs(bd.bySource.medical.amount - Math.max(0, CARE - 0.075 * agi))).toBeLessThan(5);
    expect(bd.taxDeductions).toBe(bd.itemizedTotal);
  });
});
