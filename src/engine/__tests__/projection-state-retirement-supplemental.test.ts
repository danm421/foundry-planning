import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
import type { ClientData, FamilyMember } from "../types";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";

/**
 * PA resident, age 74, single filer, whose ONLY drawable asset is a traditional
 * IRA. Pennsylvania fully excludes qualified retirement income (IRA/401(k)/
 * pension) from state taxable income after age 59.5 — with no cap. Social
 * Security is also PA-exempt. So a PA retiree living off SS + IRA should owe $0
 * of PA income tax, regardless of HOW MUCH of the IRA is distributed.
 *
 * Living expenses far exceed SS income, so after the RMD and the small checking
 * balance are exhausted the engine's supplemental-withdrawal convergence loop
 * draws the rest from the IRA. Before the fix, the per-source `retirementBreakdown`
 * that feeds the state exclusion was built ONCE from RMDs (+ scheduled draws)
 * before that loop ran, so the supplemental IRA draw was recognized as ordinary
 * income (federal + state AGI) but never entered the state retirement-exclusion
 * bucket — leaving PA taxing the supplemental withdrawal that PA law exempts.
 */
function paIraOnlyScenario(annualExpense: number): ClientData {
  return {
    client: {
      firstName: "Rin",
      lastName: "Keystone",
      dateOfBirth: "1952-03-01", // age 74 in 2026 (past 59.5 and past RMD age 73)
      filingStatus: "single",
      retirementAge: 65,
      planEndAge: 95,
    },
    accounts: [
      {
        id: "acc-checking",
        name: "Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: 20_000,
        basis: 20_000,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true, // makes hasChecking true → supplemental-withdrawal loop runs
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
      {
        id: "acc-ira",
        name: "Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 1_500_000,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: true, // RMD at age 74 + supplemental source for the loop
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
    ],
    incomes: [
      {
        id: "inc-ss",
        name: "SS",
        type: "social_security",
        owner: "client",
        annualAmount: 40_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 67,
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
      residenceState: "PA",
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
        firstName: "Rin",
        lastName: "Keystone",
        relationship: "other",
        role: "client",
        dateOfBirth: "1952-03-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("projection — state retirement exclusion covers supplemental IRA withdrawals", () => {
  it("PA excludes supplemental IRA draws (not just RMDs) from state taxable income", () => {
    // Expenses ($200k) far exceed SS ($40k) → after RMD + checking, the IRA is
    // tapped by the supplemental-withdrawal loop.
    const years = runProjection(paIraOnlyScenario(200_000));
    const y2026 = years.find((y) => y.year === 2026)!;
    const state = y2026.taxResult!.state!;
    expect(state, "state income tax result must be populated").toBeDefined();
    expect(state.state).toBe("PA");

    // The IRA draw must exceed the ~$59k age-74 RMD, proving the supplemental
    // loop engaged (otherwise the test could pass spuriously via RMD alone).
    const iraDraw = y2026.withdrawals.byAccount["acc-ira"] ?? 0;
    expect(iraDraw).toBeGreaterThan(100_000);

    // Core assertion: the ENTIRE IRA ordinary income for the year (RMD +
    // supplemental) must land in the state retirement-exclusion bucket. Before
    // the fix, only the RMD portion was excluded and `retirementIncome` fell
    // short of `income.ordinaryIncome` by the supplemental amount.
    expect(state.subtractions.retirementIncome).toBeCloseTo(
      y2026.taxResult!.income.ordinaryIncome,
      0,
    );

    // PA taxes neither SS nor (post-59.5) retirement income → $0 state tax.
    // Before the fix, the un-excluded supplemental IRA draw produced a positive
    // PA taxable income and a nonzero PA tax bill.
    expect(state.stateTaxableIncome).toBe(0);
    expect(state.stateTax).toBe(0);
  });
});
