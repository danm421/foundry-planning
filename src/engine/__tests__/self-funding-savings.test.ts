import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine";
import type { ClientData, ClientInfo, Account, Income, Expense } from "@/engine/types";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";

const SYNTH_ACCT = "synthetic-taxable-savings";
const SYNTH_RULE = "synthetic-taxable-savings-rule";
const RETIREMENT_ACCT = "acct-401k";

const PLAN_START = 2026;
const LAST_WORKING = 2034; // retirement at age 65 (born 1970) → first retirement year 2035
const PLAN_END = 2060;
const LIVING = 50_000;

/**
 * Minimal single-filer fixture exercising the self-funding waterfall:
 *  - default checking ($25k), one big pre-tax retirement account, the synthetic
 *    $0 taxable account,
 *  - one salary during working years, one living expense across the horizon,
 *  - a `fundFromExpenseReduction` savings rule of $S/yr during working years.
 * The retirement account is large enough to fund retirement without ever
 * reaching the synthetic account in the withdrawal order, so the synthetic
 * balance reflects deposits + growth only.
 */
function fixtureWithSelfFunding(
  S: number,
  opts: {
    salary: number;
    livingExpense?: number;
    growthRate?: number;
    // Share of leftover surplus the household SPENDS (rest is retained in the
    // portfolio). Self-funding draws only from the spent share, since retained
    // surplus is already in the portfolio. Defaults to 1 (legacy: spend it all).
    surplusSpendPct?: number;
  },
): ClientData {
  const living = opts.livingExpense ?? LIVING;
  const synthGrowth = opts.growthRate ?? 0.05;
  const surplusSpendPct = opts.surplusSpendPct ?? 1;

  const client: ClientInfo = {
    firstName: "Solo",
    lastName: "Saver",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 90,
    filingStatus: "single",
  };

  const accounts: Account[] = [
    {
      id: "acct-checking",
      name: "Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 25_000,
      basis: 25_000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    },
    {
      id: RETIREMENT_ACCT,
      name: "401(k)",
      category: "retirement",
      subType: "401k",
      titlingType: "jtwros",
      value: 1_500_000,
      basis: 1_500_000,
      growthRate: 0.07,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    },
    {
      id: SYNTH_ACCT,
      name: "Hypothetical Additional Savings",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 0,
      basis: 0,
      growthRate: synthGrowth,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    },
  ];

  const incomes: Income[] = [
    {
      id: "inc-salary",
      type: "salary",
      name: "Salary",
      annualAmount: opts.salary,
      startYear: PLAN_START,
      endYear: LAST_WORKING,
      growthRate: 0,
      owner: "client",
    },
  ];

  const expenses: Expense[] = [
    {
      id: "exp-living",
      type: "living",
      name: "Living Expenses",
      annualAmount: living,
      startYear: PLAN_START,
      endYear: PLAN_END,
      growthRate: 0,
    },
  ];

  return {
    client,
    accounts,
    incomes,
    expenses,
    liabilities: [],
    savingsRules:
      S > 0
        ? [
            {
              id: SYNTH_RULE,
              accountId: SYNTH_ACCT,
              annualAmount: S,
              isDeductible: false,
              rothPercent: 0,
              fundFromExpenseReduction: true,
              startYear: PLAN_START,
              endYear: LAST_WORKING,
            },
          ]
        : [],
    withdrawalStrategy: [
      { accountId: RETIREMENT_ACCT, priorityOrder: 1, startYear: PLAN_START, endYear: PLAN_END },
      { accountId: SYNTH_ACCT, priorityOrder: 2, startYear: PLAN_START, endYear: PLAN_END },
    ],
    planSettings: {
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      inflationRate: 0,
      planStartYear: PLAN_START,
      planEndYear: PLAN_END,
      surplusSpendPct,
    },
    familyMembers: [
      {
        id: LEGACY_FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Solo",
        lastName: "Saver",
        dateOfBirth: "1970-01-01",
      },
    ],
    giftEvents: [],
  };
}

describe("self-funding (fundFromExpenseReduction) savings", () => {
  it("funds entirely from cash flow when surplus >= S (no expense cut)", () => {
    const baseline = runProjection(fixtureWithSelfFunding(0, { salary: 200_000 }));
    const years = runProjection(fixtureWithSelfFunding(20_000, { salary: 200_000 }));
    const y = years[0];
    expect(y.hypotheticalSavings?.contribution).toBeCloseTo(20_000, 0);
    expect(y.hypotheticalSavings?.fromCashFlow).toBeCloseTo(20_000, 0);
    expect(y.hypotheticalSavings?.fromExpenseReduction).toBeCloseTo(0, 0);
    // living expense NOT reduced
    expect(y.expenses.living).toBeCloseTo(baseline[0].expenses.living, 0);
  });

  it("cuts living expenses for the shortfall when surplus < S", () => {
    // Modest salary → small positive surplus. The fixture spends it all
    // (surplusSpendPct defaults to 1), so the spendable surplus the waterfall can
    // draw on shows up as discretionary spend. Measure it, then ask for $5k more.
    const baseline = runProjection(fixtureWithSelfFunding(0, { salary: 90_000 }));
    const surplus0 = baseline[0].expenses.discretionary;
    expect(surplus0).toBeGreaterThan(5_000); // sanity: clean split below
    const S = surplus0 + 5_000;

    const years = runProjection(fixtureWithSelfFunding(S, { salary: 90_000 }));
    const y = years[0];
    expect(y.hypotheticalSavings?.contribution).toBeCloseTo(S, 0);
    expect(y.hypotheticalSavings?.fromCashFlow).toBeCloseTo(surplus0, -2); // ~within $50
    expect(y.hypotheticalSavings?.fromExpenseReduction).toBeCloseTo(5_000, -2);
    // living reduced by the expense-cut portion
    expect(y.expenses.living).toBeCloseTo(
      baseline[0].expenses.living - (y.hypotheticalSavings?.fromExpenseReduction ?? 0),
      0,
    );
    expect(y.expenses.living).toBeLessThan(baseline[0].expenses.living);
  });

  it("never drives the withdrawal strategy to fund the contribution", () => {
    // The funding waterfall runs during the working years. The invariant is that
    // funding the synthetic contribution never liquidates another account in those
    // years. We compare the (non-synthetic, non-checking) retirement account at the
    // end of the last working year: with self-funding it should be untouched —
    // identical to the no-savings baseline (pure growth, no contributions/draws).
    // (Past retirement the runs legitimately diverge: redirected surplus sits in the
    // synthetic instead of checking, changing the withdrawal-ordering buffer — that
    // is not "liquidating to fund S".)
    const withS = runProjection(fixtureWithSelfFunding(20_000, { salary: 90_000 }));
    const baseline = runProjection(fixtureWithSelfFunding(0, { salary: 90_000 }));
    const lastWorkingIdx = withS.findIndex((y) => y.year === LAST_WORKING);
    expect(lastWorkingIdx).toBeGreaterThan(0);
    const balWith = withS[lastWorkingIdx].accountLedgers[RETIREMENT_ACCT]?.endingValue ?? 0;
    const balBase = baseline[lastWorkingIdx].accountLedgers[RETIREMENT_ACCT]?.endingValue ?? 0;
    expect(balWith).toBeCloseTo(balBase, 2); // identical: never liquidated to fund S
    // And no household withdrawals were taken from the retirement account while funding.
    const drawnDuringFunding = withS
      .filter((y) => y.year <= LAST_WORKING)
      .reduce((sum, y) => sum + (y.accountLedgers[RETIREMENT_ACCT]?.distributions ?? 0), 0);
    expect(drawnDuringFunding).toBeCloseTo(0, 2);
  });

  it("stops contributing after retirement but keeps growing the balance", () => {
    const years = runProjection(fixtureWithSelfFunding(20_000, { salary: 200_000 }));
    const retYearIdx = years.findIndex(
      (y) => (y.hypotheticalSavings?.contribution ?? 0) === 0,
    );
    expect(retYearIdx).toBeGreaterThan(0); // some retirement year has no contribution
    const synthBalAtRet = years[retYearIdx].accountLedgers[SYNTH_ACCT]?.endingValue ?? 0;
    const synthBalLater = years.at(-1)!.accountLedgers[SYNTH_ACCT]?.endingValue ?? 0;
    expect(synthBalAtRet).toBeGreaterThan(0); // accumulated during working years
    expect(synthBalLater).toBeGreaterThan(synthBalAtRet); // growth continues
  });
});

// Sum every account's ending value in a given year — the whole portfolio, so a
// relocation between accounts nets to zero while real new money shows up.
function totalPortfolioInYear(data: ClientData, year: number): number {
  const years = runProjection(data);
  const y = years.find((r) => r.year === year)!;
  return Object.values(y.accountLedgers).reduce((s, l) => s + (l.endingValue ?? 0), 0);
}

// When surplus is RETAINED in the portfolio (surplusSpendPct < 1), it is already
// invested — so self-funding must NOT draw on it (that would merely relocate cash
// from checking to the brokerage, adding no new money and leaving PoS flat). It must
// instead reduce consumption: cut living expenses. This is the min-savings
// "unreachable at $100k/yr" root cause — the lever was inert against retained surplus.
describe("self-funding draws only from SPENT surplus, not retained surplus", () => {
  it("spendPct=0: funds entirely from expense reduction, never from retained cash flow", () => {
    const baseline = runProjection(
      fixtureWithSelfFunding(0, { salary: 200_000, surplusSpendPct: 0 }),
    );
    const years = runProjection(
      fixtureWithSelfFunding(20_000, { salary: 200_000, surplusSpendPct: 0 }),
    );
    const y = years[0];
    expect(y.hypotheticalSavings?.contribution).toBeCloseTo(20_000, 0);
    expect(y.hypotheticalSavings?.fromCashFlow).toBeCloseTo(0, 0); // retained surplus is off-limits
    expect(y.hypotheticalSavings?.fromExpenseReduction).toBeCloseTo(20_000, 0);
    // living cut by the full amount
    expect(y.expenses.living).toBeCloseTo(baseline[0].expenses.living - 20_000, 0);
  });

  it("spendPct=0: the lever adds REAL money to the portfolio (not a relocation no-op)", () => {
    const base = totalPortfolioInYear(
      fixtureWithSelfFunding(0, { salary: 200_000, surplusSpendPct: 0 }),
      LAST_WORKING,
    );
    const withLever = totalPortfolioInYear(
      fixtureWithSelfFunding(20_000, { salary: 200_000, surplusSpendPct: 0 }),
      LAST_WORKING,
    );
    // 9 working years of $20k deposits, grown — well above any growth-differential
    // lift the old relocation behavior could produce (~$50k).
    expect(withLever - base).toBeGreaterThan(150_000);
  });
});
