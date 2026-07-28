import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData } from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

/**
 * §1212(b) capital-loss carryforward threaded through `runProjection`.
 *
 * SEMANTICS UNDER TEST — `taxDetail.capitalLossCarryforward` is the
 * END-OF-YEAR (post-drawdown) state: the year's §1211(b) deduction has already
 * been taken out of it. So a plan seeded at $20,000 reads $17,000 in its first
 * year, not $20,000.
 *
 * All three scenarios run in BRACKET mode with a large ordinary income and no
 * realized gains, so every year absorbs the full $3,000 §1211(b) offset
 * (the §1212(b)(2) taxable-income consumption test never binds).
 */

const IRA_ID = "acc-ira";

function baseScenario(): ClientData {
  return {
    client: {
      firstName: "CapLoss",
      lastName: "Test",
      dateOfBirth: "1955-01-01",
      filingStatus: "married_joint",
      retirementAge: 65,
      planEndAge: 95,
    },
    accounts: [
      {
        id: "acc-cash",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        isDefaultChecking: true,
        value: 1_000_000,
        basis: 1_000_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ],
    incomes: [
      {
        id: "inc-salary",
        name: "Salary",
        type: "salary",
        owner: "client",
        annualAmount: 500_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2040,
      },
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2029,
      taxEngineMode: "bracket",
      taxInflationRate: 0,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [TAX_YEAR_2026],
    wills: [],
    familyMembers: [],
    externalBeneficiaries: [],
  } as ClientData;
}

describe("capital-loss carryforward across projection years", () => {
  it("seeds from plan settings and draws down $3,000 per year", () => {
    const data = baseScenario();
    data.planSettings.capitalLossCarryforwardLongTerm = 20_000;
    data.planSettings.capitalLossCarryforwardShortTerm = 0;

    const years = runProjection(data);

    // 2026..2029 = 4 years. End-of-year state, so the last year reads
    // 20,000 − 3,000 × 4 = 8,000.
    expect(years.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029]);
    expect(years[0].taxDetail?.capitalLossCarryforward?.longTerm).toBe(17_000);
    const last = years[years.length - 1];
    expect(last.taxDetail?.capitalLossCarryforward?.longTerm).toBe(8_000);
    expect(last.taxDetail?.capitalLossCarryforward?.shortTerm).toBe(0);
    // §1211(b) offset actually taken in the final year.
    expect(last.taxDetail?.capitalLossDeduction).toBe(3_000);
  });

  it("advances the carryforward ONCE per year, not once per solver iteration", () => {
    // Expenses far exceed income, and the only fundable source is a traditional
    // IRA whose withdrawals are themselves taxable — so the phase-12
    // supplemental-withdrawal convergence loop genuinely iterates (each draw
    // raises tax, which raises the required draw). Every one of those
    // iterations rebuilds a YearTaxInput carrying `capitalLossCarryforwardIn`.
    // The carryforward must still fall by exactly $3,000 per YEAR.
    const data = baseScenario();
    data.planSettings.planEndYear = 2027;
    data.planSettings.capitalLossCarryforwardLongTerm = 50_000;
    data.planSettings.capitalLossCarryforwardShortTerm = 0;
    // Small checking balance so the deficit hits the gap-fill immediately.
    data.accounts[0].value = 50_000;
    data.accounts[0].basis = 50_000;
    data.accounts.push({
      id: IRA_ID,
      name: "Traditional IRA",
      category: "retirement",
      subType: "traditional_ira",
      titlingType: "jtwros",
      value: 5_000_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    } as unknown as ClientData["accounts"][number]);
    data.withdrawalStrategy = [
      { accountId: IRA_ID, priorityOrder: 1, startYear: 2026, endYear: 2027 },
    ];
    data.expenses = [
      {
        id: "exp-living",
        type: "living",
        name: "Living",
        annualAmount: 2_000_000,
        startYear: 2026,
        endYear: 2027,
        growthRate: 0,
      },
    ];

    const years = runProjection(data);

    // Sanity: the scenario really does force supplemental withdrawals.
    expect(years[0].withdrawals.byAccount[IRA_ID] ?? 0).toBeGreaterThan(0);
    expect(years[1].withdrawals.byAccount[IRA_ID] ?? 0).toBeGreaterThan(0);

    expect(years[0].taxDetail?.capitalLossCarryforward?.longTerm).toBe(47_000);
    expect(years[1].taxDetail?.capitalLossCarryforward?.longTerm).toBe(44_000);
  });

  /**
   * Ledger 24 — all three scenarios above seed `shortTerm: 0`, so §1212(b)'s
   * SHORT-term-first absorption ordering was never proven end-to-end: an
   * implementation that absorbed long-term first would pass every one of them.
   */
  it("absorbs SHORT-term loss first when both characters are seeded", () => {
    const data = baseScenario();
    data.planSettings.planEndYear = 2026;
    data.planSettings.capitalLossCarryforwardShortTerm = 5_000;
    data.planSettings.capitalLossCarryforwardLongTerm = 20_000;

    const years = runProjection(data);

    // §1212(b): the $3,000 deduction comes entirely out of the 5,000 of
    // short-term loss. Long-term is untouched.
    expect(years[0].taxDetail?.capitalLossDeduction).toBe(3_000);
    expect(years[0].taxDetail?.capitalLossCarryforward).toEqual({
      shortTerm: 2_000,
      longTerm: 20_000,
    });
  });

  it("expires half the carryforward at first death (Rev. Rul. 74-175)", () => {
    // Client born 1960 with LE 67 → first death in 2027. Spouse born 1962 with
    // LE 95 → 2057, outside the 2026-2029 horizon, so no FINAL death fires.
    const data = baseScenario();
    data.client.dateOfBirth = "1960-01-01";
    data.client.lifeExpectancy = 67;
    data.client.spouseDob = "1962-01-01";
    data.client.spouseLifeExpectancy = 95;
    data.planSettings.capitalLossCarryforwardLongTerm = 100_000;
    data.planSettings.capitalLossCarryforwardShortTerm = 0;
    // The survivor needs her own income so post-death years still have taxable
    // income to absorb the §1211(b) offset (§1212(b)(2) would otherwise cap
    // consumption below $3,000).
    data.incomes.push({
      id: "inc-salary-spouse",
      name: "Spouse Salary",
      type: "salary",
      owner: "spouse",
      annualAmount: 500_000,
      growthRate: 0,
      startYear: 2026,
      endYear: 2040,
    } as unknown as ClientData["incomes"][number]);

    const years = runProjection(data);

    const deathYear = years.find((y) => y.year === 2027)!;
    const afterDeath = years.find((y) => y.year === 2028)!;

    // In `runProjection` the first-death block runs AFTER `years.push()` for
    // the death year, so the death year's recorded value is its own
    // post-drawdown exit state and does NOT yet reflect the halving.
    // 2026 exits at 97,000; 2027 exits at 94,000.
    expect(deathYear.taxDetail?.capitalLossCarryforward?.longTerm).toBe(94_000);
    // 94,000 halved at death → 47,000 enters 2028, which exits at 44,000.
    // (Without the halving this would read 91,000.)
    expect(afterDeath.taxDetail?.capitalLossCarryforward?.longTerm).toBeCloseTo(44_000, 2);
  });
});
