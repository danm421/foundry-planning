import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember } from "../types";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

/**
 * Margin loans (spec 2026-10-13) — Form 4952 investment-interest deduction
 * threaded through `runProjection`.
 *
 * NII (plan R4) = household-like interest / non-qualified dividends from
 * account growth + every short-term gain on the return. In this fixture the
 * checking account grows at 0% (no realization) and the salary is earned
 * income, so the margined account's own ordinary income IS the year's NII —
 * which is what lets the expectations read it straight off that ledger.
 */

const PUBLIC_CHARITY_ID = "00000000-0000-0000-0000-000000000aaa";
const PRIVATE_CHARITY_ID = "00000000-0000-0000-0000-000000000bbb";
const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";

// Copied verbatim from charitable-deduction-integration.test.ts.
function baseScenario(): ClientData {
  return {
    client: {
      firstName: "Charitable",
      lastName: "Test",
      // dateOfBirth replaces birthYear/currentAge (ClientInfo uses DOB strings, not year ints)
      dateOfBirth: "1970-01-01",
      filingStatus: "married_joint",
      retirementAge: 67,
      // planEndAge replaces lifeExpectancy on the ClientInfo shape
      planEndAge: 90,
    },
    accounts: [
      {
        id: "acc-cash",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        value: 5_000_000,
        basis: 5_000_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      } as ClientData["accounts"][number],
    ],
    incomes: [
      {
        id: "inc-salary",
        // annualAmount is the runtime field (not `amount`)
        name: "Salary",
        type: "salary",
        owner: "client",
        annualAmount: 1_000_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2030,
      } as ClientData["incomes"][number],
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
      planEndYear: 2030,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    // giftEvents is required (not optional) in ClientData
    giftEvents: [],
    // Seed bracket-mode tax params so the engine actually itemizes — without
    // these the engine falls back to FLAT mode, where no charitable deduction is
    // ever realized and these AGI-limit assertions are meaningless. (Pre-F23 the
    // tests "passed" in flat mode only because the buggy standard branch consumed
    // gifts out of carryforward; the fix made that no longer happen.)
    taxYearRows: [TAX_YEAR_2026],
    wills: [],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Client",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: "1970-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [
      { id: PUBLIC_CHARITY_ID, name: "Stanford", kind: "charity", charityType: "public" },
      { id: PRIVATE_CHARITY_ID, name: "Smith Family Foundation", kind: "charity", charityType: "private" },
    ],
  } as ClientData;
}

const margined = {
  id: "acct-margin", name: "Schwab Brokerage", category: "taxable", subType: "brokerage",
  value: 10_000_000, basis: 10_000_000, growthRate: 0.07, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
  marginBalance: 2_000_000, marginInterestRate: 0.08, marginCallPct: 0.3,
  realization: { pctOrdinaryIncome: 0.05, pctQualifiedDividends: 0, pctLtCapitalGains: 0.95, pctTaxExempt: 0, turnoverPct: 0 },
} as ClientData["accounts"][number];

describe("investment-interest deduction in the projection", () => {
  const years = runProjection({ ...baseScenario(), accounts: [...baseScenario().accounts, margined] });
  const [y1, y2] = years;
  const l1 = y1.accountLedgers["acct-margin"];
  const l2 = y2.accountLedgers["acct-margin"];

  it("the fixture's NII is the margined account's ordinary income alone", () => {
    // Guards the reading of the expectations below (ruling R-pre4): no other
    // account realizes income and no short-term gain is on the return.
    expect(y1.taxDetail!.stCapitalGains).toBe(0);
    expect(y2.taxDetail!.stCapitalGains).toBe(0);
    expect(l1.growthDetail!.ordinaryIncome).toBeGreaterThan(0);
    expect(y1.accountLedgers["acc-cash"].growthDetail).toBeUndefined();
  });

  it("year 1 allows interest up to NII (the account's ordinary income)", () => {
    expect(y1.deductionBreakdown!.belowLine.investmentInterest)
      .toBeCloseTo(Math.min(l1.marginInterest!, l1.growthDetail!.ordinaryIncome), 2);
  });

  it("year 2 adds year 1's disallowed interest to the pool", () => {
    const carry1 = l1.marginInterest! - y1.deductionBreakdown!.belowLine.investmentInterest;
    expect(carry1).toBeGreaterThan(0);
    expect(y2.deductionBreakdown!.belowLine.investmentInterest)
      .toBeCloseTo(Math.min(l2.marginInterest! + carry1, l2.growthDetail!.ordinaryIncome), 2);
  });

  it("the allowed amount is inside itemizedTotal", () => {
    const bl = y1.deductionBreakdown!.belowLine;
    expect(bl.itemizedTotal).toBeCloseTo(bl.charitable + bl.taxesPaid + bl.interestPaid + bl.otherItemized + bl.investmentInterest, 2);
  });

  it("names the account in the below-line drill", () => {
    const row = y1.deductionBreakdown!.belowLine.bySource["investment-interest:acct-margin"];
    expect(row?.label).toBe("Investment interest — Schwab Brokerage");
    expect(row?.amount).toBeCloseTo(y1.deductionBreakdown!.belowLine.investmentInterest, 2);
  });

  it("advances the carryforward ONCE per year, not once per solver iteration", () => {
    // Modelled on capital-loss-carryforward.test.ts: expenses far exceed
    // income and the only fundable source is a traditional IRA whose draws are
    // themselves taxable, so the phase-12 supplemental-withdrawal convergence
    // loop genuinely iterates. A year-2-only short-term gain lifts NII above
    // the whole pool, so year 2's allowed amount is EXACTLY its interest plus
    // year 1's carry — any extra advance of the carry would show up here.
    const IRA_ID = "acc-ira";
    const data = baseScenario();
    data.planSettings.planEndYear = 2027;
    data.accounts[0].value = 50_000;
    data.accounts[0].basis = 50_000;
    data.accounts.push(margined, {
      id: IRA_ID,
      name: "Traditional IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: 5_000_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
    } as ClientData["accounts"][number]);
    data.withdrawalStrategy = [
      { accountId: IRA_ID, priorityOrder: 1, startYear: 2026, endYear: 2027 },
    ];
    data.expenses = [
      {
        id: "exp-living",
        type: "living",
        name: "Living",
        annualAmount: 3_000_000,
        startYear: 2026,
        endYear: 2027,
        growthRate: 0,
      },
    ];
    data.incomes.push({
      id: "inc-stcg",
      name: "Trading gains",
      type: "other",
      taxType: "stcg",
      owner: "client",
      annualAmount: 2_000_000,
      growthRate: 0,
      startYear: 2027,
      endYear: 2027,
    } as ClientData["incomes"][number]);

    const [a1, a2] = runProjection(data);

    // Sanity: the scenario really does force supplemental withdrawals.
    expect(a1.withdrawals.byAccount[IRA_ID] ?? 0).toBeGreaterThan(0);
    expect(a2.withdrawals.byAccount[IRA_ID] ?? 0).toBeGreaterThan(0);

    const m1 = a1.accountLedgers["acct-margin"];
    const m2 = a2.accountLedgers["acct-margin"];
    const allowed1 = a1.deductionBreakdown!.belowLine.investmentInterest;
    expect(allowed1).toBeCloseTo(Math.min(m1.marginInterest!, m1.growthDetail!.ordinaryIncome), 2);
    const carry1 = m1.marginInterest! - allowed1;
    expect(carry1).toBeGreaterThan(0);
    // Year 2's NII clears the whole pool by a wide margin, so the assertion
    // below is sensitive to the size of the carry.
    expect(m2.growthDetail!.ordinaryIncome + a2.taxDetail!.stCapitalGains)
      .toBeGreaterThan(2 * (m2.marginInterest! + carry1));
    expect(a2.deductionBreakdown!.belowLine.investmentInterest)
      .toBeCloseTo(m2.marginInterest! + carry1, 2);
  });
});
