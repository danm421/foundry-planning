import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { getObbbaSeniorBonus } from "../../lib/tax/senior-deductions";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
import type { ClientData, FamilyMember } from "../types";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";

// The shared TAX_YEAR_2026 fixture has a round $30,000 MFJ standard deduction.
// Bracket mode is the path under test — the senior deductions only flow through
// the bracket calculator. §63(f) is permanent law: $1,650/box for married, 2
// boxes when both spouses are 65+. The resolver hands the calculator
// inflationFactor 1.0 for an exact-year tax row (resolver.ts:34), so 2026 =
// floorToStep(1650 * 2 * 1.0, 50) = 3300.
const BASE_STD_MFJ_2026 = 30_000;
const ADDL_STD_BOTH_65_2026 = 3_300;

/**
 * MFJ household, both spouses born 1957 → age 69 in 2026: 65+ (so both senior
 * deductions apply) but under 73 (no RMD, which keeps forced income low and AGI
 * below the OBBBA $150k phaseout). A small default joint-checking account makes
 * `hasChecking` true; living expenses above the SS income force the
 * supplemental-withdrawal convergence loop — the path that (before the fix)
 * rebuilt YearTaxInput without primaryAge/spouseAge and silently dropped the
 * senior deductions.
 *
 * `annualExpense` tunes the scenario:
 *   - high (> SS income) → shortfall → supplemental loop runs (the buggy path)
 *   - low  (< SS income) → surplus → no loop, baseTaxInput is the final result
 */
function seniorScenario(annualExpense: number): ClientData {
  return {
    client: {
      firstName: "Pat",
      lastName: "Senior",
      dateOfBirth: "1957-03-01", // age 69 in 2026
      spouseDob: "1957-08-01",   // age 69 in 2026
      filingStatus: "married_joint",
      retirementAge: 65,
      planEndAge: 95,
      spouseRetirementAge: 65,
    },
    accounts: [
      {
        id: "acc-checking",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: 20_000,
        basis: 20_000,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true, // makes hasChecking true → the supplemental-withdrawal loop runs
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      {
        id: "acc-ira",
        name: "Pat Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 1_500_000,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: true, // no effect at age 69 — supplemental source for the loop
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
    ],
    incomes: [
      {
        id: "inc-ss",
        name: "Pat SS",
        type: "social_security",
        owner: "client",
        annualAmount: 40_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 67, // already claiming at age 69
      },
    ],
    expenses: [
      {
        id: "exp-living",
        type: "living",
        name: "Living Expenses",
        annualAmount: annualExpense,
        startYear: 2026,
        endYear: 2055,
        growthRate: 0.03,
      },
    ],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [
      { accountId: "acc-checking", priorityOrder: 1, startYear: 2026, endYear: 2055 },
      { accountId: "acc-ira", priorityOrder: 2, startYear: 2026, endYear: 2055 },
    ],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2027,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
      residenceState: null,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [],
    rothConversions: [],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Pat",
        lastName: "Senior",
        relationship: "other",
        role: "client",
        dateOfBirth: "1957-03-01",
      } as FamilyMember,
      {
        id: SPOUSE_FM_ID,
        firstName: "Partner",
        lastName: "Senior",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1957-08-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("projection — senior deductions survive the supplemental-withdrawal loop", () => {
  it("applies the §63(f) additional std deduction on the loop (shortfall) path", () => {
    // Expenses ($90k) far exceed SS income ($40k) → supplemental-withdrawal loop runs.
    const years = runProjection(seniorScenario(90_000));
    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026.taxResult, "year-2026 taxResult must be populated").toBeDefined();

    // The IRA must have been drawn for supplemental withdrawals (no RMD at age
    // 69 and no scheduled draw, so any draw proves the loop engaged — otherwise
    // this test would pass spuriously via baseTaxInput).
    expect(y2026.withdrawals.byAccount["acc-ira"] ?? 0).toBeGreaterThan(0);

    // belowLineDeductions must include the §63(f) add-on, not the base std alone.
    expect(y2026.taxResult!.flow.belowLineDeductions).toBe(
      BASE_STD_MFJ_2026 + ADDL_STD_BOTH_65_2026,
    );
  });

  it("applies the OBBBA senior bonus (TY2025-2028) on the loop path", () => {
    const years = runProjection(seniorScenario(90_000));
    const y2026 = years.find((y) => y.year === 2026)!;
    const flow = y2026.taxResult!.flow;

    const agi = flow.adjustedGrossIncome;
    // Stay below the per-senior phaseout so the full $12k ($6k × 2 seniors) applies.
    expect(agi).toBeLessThan(150_000);
    const expectedBonus = getObbbaSeniorBonus(2026, "married_joint", 69, 69, agi);
    expect(expectedBonus).toBe(12_000);

    // taxableIncome = max(0, AGI − belowLineDeductions − seniorBonus − qbi(0)).
    // If the loop dropped the ages, seniorBonus would be 0 and taxableIncome
    // would be $12k higher.
    expect(flow.taxableIncome).toBeCloseTo(
      Math.max(0, agi - flow.belowLineDeductions - expectedBonus),
      0,
    );
  });

  it("regression: surplus year (no loop) still carries the senior deductions", () => {
    // Expenses ($10k) below SS income ($40k) → surplus, no supplemental loop.
    // This path already used baseTaxInput correctly; the guard keeps both paths
    // consistent so a future change can't silently diverge them again.
    const years = runProjection(seniorScenario(10_000));
    const y2026 = years.find((y) => y.year === 2026)!;
    // Confirm the loop did NOT run (no supplemental IRA draw) — otherwise this
    // would be exercising the same path as the tests above.
    expect(y2026.withdrawals.byAccount["acc-ira"] ?? 0).toBe(0);
    expect(y2026.taxResult!.flow.belowLineDeductions).toBe(
      BASE_STD_MFJ_2026 + ADDL_STD_BOTH_65_2026,
    );
  });
});
