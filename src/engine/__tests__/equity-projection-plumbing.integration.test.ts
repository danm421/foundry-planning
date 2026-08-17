/**
 * Equity ↔ projection plumbing (audit G4). Drives the REAL `runProjection`.
 *
 * The theme these three findings share: equity is bolted onto the projection
 * rather than wired into it, so the equity module and the plan around it are
 * not reading the same books.
 *
 *   F10      — vested stock the engine can see but cannot spend. The effective
 *              withdrawal strategy is snapshotted BEFORE the year loop; the
 *              equity destination account is created INSIDE it.
 *   F30/F38  — cash spent exercising options never reaches the cash-flow
 *              statement, because only POSITIVE equity net cash was folded in.
 *   F31      — with no destination account, vested shares were booked into
 *              household checking as cash.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  ClientInfo,
  Expense,
  FamilyMember,
  Income,
  PlanSettings,
} from "../types";
import type { StockOptionPlan } from "../equity/types";
import { LEGACY_FM_CLIENT } from "../ownership";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

// ── Shared fixture ──────────────────────────────────────────────────────────
// One client, one RSU grant of 1,000 shares vesting 2027 at FMV 110, held.
// Shares appreciate 10%/yr, so the destination account is worth $146,410 by
// 2029 — comfortably more than any shortfall the tests below manufacture.

const PLAN_START = 2026;
const PLAN_END = 2032;
const PRICE = 100;
const GROWTH = 0.1;
const VEST_YEAR = 2027;
const SHARES = 1_000;
const SO_ID = "so-equity";
const DEST_ID = `equity-dest-${SO_ID}`;

const fmv = (year: number) => PRICE * (1 + GROWTH) ** (year - PLAN_START);

const CLIENT: ClientInfo = {
  firstName: "Equity",
  lastName: "Holder",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "single",
};

const FM: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Equity",
  lastName: "Holder",
  dateOfBirth: "1980-01-01",
};

const PLAN_SETTINGS: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: PLAN_START,
  planEndYear: PLAN_END,
  taxEngineMode: "bracket",
  taxInflationRate: 0,
};

const CHECKING: Account = {
  id: "checking",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 20_000,
  basis: 20_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const SO_ACCOUNT: Account = {
  id: SO_ID,
  name: "ACME Equity",
  category: "stock_options",
  subType: "stock_options",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: GROWTH,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const SALARY: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Salary",
  annualAmount: 60_000,
  startYear: PLAN_START,
  endYear: PLAN_END,
  growthRate: 0,
  owner: "client",
};

/** RSU plan: 1,000 shares vest 2027 and are held (no sale inside the window). */
const HOLD_PLAN: StockOptionPlan = {
  accountId: SO_ID,
  ticker: "ACME",
  pricePerShare: PRICE,
  growthRate: GROWTH,
  destinationAccountId: null,
  autoCreateDestination: true,
  sellToCover: false,
  withholdingRate: 0,
  strategy: {
    exerciseTiming: "at_vest",
    exerciseYear: null,
    sellTiming: "hold",
    sellYear: null,
    sellPercentPerYear: null,
    sellStartYear: null,
  },
  owner: "client",
  grants: [
    {
      id: "g-rsu",
      grantNumber: "RSU-1",
      grantType: "rsu",
      grantDate: "2025-01-15",
      sharesGranted: SHARES,
      has83bElection: false,
      fmvAtGrant: null,
      strikePrice: null,
      strikeDiscountPct: null,
      expirationYear: null,
      strategy: { sellTiming: "hold" },
      tranches: [
        {
          id: "t-rsu",
          vestDate: `${VEST_YEAR}-01-15`,
          shares: SHARES,
          sharesExercised: 0,
          sharesSold: 0,
          acquiredOn: null,
          priceAtAcquisition: null,
          strategy: null,
        },
      ],
      plannedEvents: [],
    },
  ],
};

function buildData(over: Partial<ClientData>): ClientData {
  return {
    client: CLIENT,
    accounts: [CHECKING, SO_ACCOUNT],
    incomes: [SALARY],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: PLAN_SETTINGS,
    familyMembers: [FM],
    giftEvents: [],
    taxYearRows: [TAX_YEAR_2026],
    ...over,
  };
}

// ── F10 — vested stock the engine can see but cannot spend ──────────────────

describe("F10 — the equity destination account is a drawdown source", () => {
  const DEFICIT_YEAR = 2029;
  // Big enough that salary + accumulated checking cannot cover it, so the plan
  // must reach into the portfolio. Checking ended 2028 at ~$125k.
  const BIG_EXPENSE: Expense = {
    id: "exp-big",
    name: "Big one-off",
    annualAmount: 250_000,
    startYear: DEFICIT_YEAR,
    endYear: DEFICIT_YEAR,
    growthRate: 0,
    type: "other",
  };

  const years = runProjection(
    buildData({ expenses: [BIG_EXPENSE], stockOptionPlans: [HOLD_PLAN] }),
  );
  const deficit = years.find((y) => y.year === DEFICIT_YEAR)!;

  it("holds vested shares worth more than the shortfall going in", () => {
    // Guards the fixture: if the destination were empty the drawdown assertions
    // below would pass vacuously. Measured at the END of the year BEFORE the
    // deficit — that is the balance available to fund it.
    const priorYear = years.find((y) => y.year === DEFICIT_YEAR - 1)!;
    expect(priorYear.portfolioAssets.taxable[DEST_ID]).toBeCloseTo(
      SHARES * fmv(DEFICIT_YEAR),
      0,
    );
  });

  it("funds the deficit year out of the vested shares", () => {
    expect(deficit.withdrawals.byAccount[DEST_ID] ?? 0).toBeGreaterThan(0);
    const drawn = deficit.withdrawals.byAccount[DEST_ID];
    // The shortfall against the pre-fix run was $77,022; the draw is grossed up
    // for the tax on the realized gain, so bound it rather than pinning it.
    expect(drawn).toBeGreaterThan(70_000);
    expect(drawn).toBeLessThan(120_000);
  });

  it("leaves household checking solvent instead of overdrawn", () => {
    // Pre-fix this year ended at -$77,022 and stayed negative into 2030.
    expect(deficit.portfolioAssets.cash["checking"] ?? 0).toBeGreaterThanOrEqual(-1);
    const after = years.find((y) => y.year === DEFICIT_YEAR + 1)!;
    expect(after.portfolioAssets.cash["checking"] ?? 0).toBeGreaterThanOrEqual(-1);
  });

  it("posts the draw on the destination account's Portfolio Activity", () => {
    const entries = deficit.accountLedgers[DEST_ID]?.entries ?? [];
    expect(
      entries.some((e) => /Withdrawal to cover household shortfall/.test(e.label ?? "")),
    ).toBe(true);
  });

  it("draws an ordinary taxable account before the equity destination", () => {
    // The appended entry sits in the taxable tier but strictly AFTER every
    // existing liquid account, so a real brokerage is spent first.
    const BROKERAGE: Account = {
      id: "brokerage",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 200_000,
      basis: 200_000,
      growthRate: 0,
      rmdEnabled: false,
      realization: {
        pctOrdinaryIncome: 0,
        pctLtCapitalGains: 1,
        pctQualifiedDividends: 0,
        pctTaxExempt: 0,
        turnoverPct: 0,
      },
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const withBrokerage = runProjection(
      buildData({
        accounts: [CHECKING, SO_ACCOUNT, BROKERAGE],
        expenses: [BIG_EXPENSE],
        stockOptionPlans: [HOLD_PLAN],
      }),
    ).find((y) => y.year === DEFICIT_YEAR)!;
    // The brokerage alone covers the gap, so the equity destination is untouched.
    expect(withBrokerage.withdrawals.byAccount["brokerage"] ?? 0).toBeGreaterThan(0);
    expect(withBrokerage.withdrawals.byAccount[DEST_ID] ?? 0).toBe(0);
    expect(withBrokerage.portfolioAssets.taxable[DEST_ID]).toBeCloseTo(
      SHARES * fmv(DEFICIT_YEAR + 1),
      0,
    );
  });
});

// ── F30/F38 — cash spent exercising options reaches the cash-flow statement ──

describe("F30/F38 — equity cash OUT is reported, not just cash IN", () => {
  const EXERCISE_YEAR = 2028; // FMV 121
  const NQSO_SHARES = 5_000;
  const STRIKE = 10;
  const STRIKE_OUTFLOW = NQSO_SHARES * STRIKE; // $50,000 paid out of pocket

  // Checking is deep enough that the exercise never triggers a shortfall —
  // this test is about REPORTING, not funding.
  const FUNDED_CHECKING: Account = { ...CHECKING, value: 500_000, basis: 500_000 };

  /** NQSO exercised at vest and HELD: pays strike, receives nothing. */
  const EXERCISE_AND_HOLD: StockOptionPlan = {
    ...HOLD_PLAN,
    grants: [
      {
        id: "g-nqso",
        grantNumber: "NQ-1",
        grantType: "nqso",
        grantDate: "2025-01-15",
        sharesGranted: NQSO_SHARES,
        has83bElection: false,
        fmvAtGrant: null,
        strikePrice: STRIKE,
        strikeDiscountPct: null,
        expirationYear: 2035,
        strategy: { exerciseTiming: "at_vest", sellTiming: "hold" },
        tranches: [
          {
            id: "t-nq",
            vestDate: `${EXERCISE_YEAR}-01-15`,
            shares: NQSO_SHARES,
            sharesExercised: 0,
            sharesSold: 0,
            acquiredOn: null,
            priceAtAcquisition: null,
            strategy: null,
          },
        ],
        plannedEvents: [],
      },
    ],
  };

  const fixture = (over: Partial<ClientData>) =>
    buildData({ accounts: [FUNDED_CHECKING, SO_ACCOUNT], ...over });

  const equityYears = runProjection(fixture({ stockOptionPlans: [EXERCISE_AND_HOLD] }));
  const baseYears = runProjection(fixture({ stockOptionPlans: [] }));
  const cashAt = (ys: typeof equityYears, y: number) =>
    ys.find((x) => x.year === y)!.portfolioAssets.cash[CHECKING.id] ?? 0;

  it("moves the strike cash out of checking", () => {
    // Fixture guard: the outflow really happens on the balance side. This has
    // always been true — creditCash is unconditional; only the REPORTING was
    // gated. Without the exercise there is nothing for the tests below to miss.
    const entries = equityYears.find((y) => y.year === EXERCISE_YEAR)!
      .accountLedgers[CHECKING.id]!.entries;
    const equityEntry = entries.find((e) => /equity proceeds/.test(e.label ?? ""));
    expect(equityEntry?.amount).toBeCloseTo(-STRIKE_OUTFLOW, 2);
  });

  it("reconciles net cash flow with the actual checking movement", () => {
    // In this fixture every dollar of household cash flow lands in checking —
    // no savings rules, no surplus transfer target — so year-over-year checking
    // movement IS net cash flow. The baseline below proves that invariant; the
    // equity run broke it by exactly the strike outflow ($50,000).
    const movement = cashAt(equityYears, EXERCISE_YEAR) - cashAt(equityYears, EXERCISE_YEAR - 1);
    const reported = equityYears.find((y) => y.year === EXERCISE_YEAR)!.netCashFlow;
    expect(movement).toBeCloseTo(reported, 0);
  });

  it("holds that same reconciliation on the no-equity baseline", () => {
    // Guards the invariant the assertion above leans on: if checking movement
    // and netCashFlow diverged for unrelated reasons, the test above would be
    // measuring noise.
    const movement = cashAt(baseYears, EXERCISE_YEAR) - cashAt(baseYears, EXERCISE_YEAR - 1);
    const reported = baseYears.find((y) => y.year === EXERCISE_YEAR)!.netCashFlow;
    expect(movement).toBeCloseTo(reported, 0);
  });

  it("carries the outflow on the per-plan drill-down key", () => {
    const y = equityYears.find((x) => x.year === EXERCISE_YEAR)!;
    expect(y.income.bySource[`equity-proceeds:${SO_ID}`]).toBeCloseTo(-STRIKE_OUTFLOW, 2);
  });

  it("still reports positive equity cash the same way", () => {
    // Regression guard on the other side of the dropped gate: exercise-and-sell
    // nets cash IN, and that must keep flowing to the same key.
    const SELL: StockOptionPlan = {
      ...EXERCISE_AND_HOLD,
      grants: [
        {
          ...EXERCISE_AND_HOLD.grants[0],
          strategy: { exerciseTiming: "at_vest", sellTiming: "immediately" },
        },
      ],
    };
    const y = runProjection(fixture({ stockOptionPlans: [SELL] })).find(
      (x) => x.year === EXERCISE_YEAR,
    )!;
    const proceeds = y.income.bySource[`equity-proceeds:${SO_ID}`];
    // 5,000 × (121 − 10) = $555,000 net of the strike already paid.
    expect(proceeds).toBeCloseTo(NQSO_SHARES * (fmv(EXERCISE_YEAR) - STRIKE), 2);
  });
});

// ── F31 — in-kind shares never land in a cash account ───────────────────────

describe("F31 — vested shares are never booked into a cash account", () => {
  const acquiredValue = SHARES * fmv(VEST_YEAR); // $110,000 at vest

  /** The reference run: a plan that mints its own destination account. */
  const withDestination = runProjection(buildData({ stockOptionPlans: [HOLD_PLAN] }));

  it("holds the shares outside cash when the plan names no destination", () => {
    // Pre-fix this fell back to the household checking id and booked $110,000
    // of employer stock into checking AS CASH: it stopped appreciating, became
    // fully spendable, and a later sell drained a balance no shares backed.
    const noDestination = runProjection(
      buildData({
        stockOptionPlans: [
          { ...HOLD_PLAN, autoCreateDestination: false, destinationAccountId: null },
        ],
      }),
    );
    const vest = noDestination.find((y) => y.year === VEST_YEAR)!;
    expect(vest.portfolioAssets.taxable[DEST_ID]).toBeCloseTo(acquiredValue * (1 + GROWTH), 0);

    // And checking is untouched by the in-kind movement — every year matches
    // the run that always had a destination.
    for (const y of noDestination) {
      const ref = withDestination.find((r) => r.year === y.year)!;
      expect(y.portfolioAssets.cash[CHECKING.id] ?? 0).toBeCloseTo(
        ref.portfolioAssets.cash[CHECKING.id] ?? 0,
        4,
      );
    }
  });

  it("refuses a cash account the plan names explicitly", () => {
    const SAVINGS: Account = {
      id: "savings",
      name: "Savings",
      category: "cash",
      subType: "savings",
      titlingType: "jtwros",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const namedCash = runProjection(
      buildData({
        accounts: [CHECKING, SO_ACCOUNT, SAVINGS],
        stockOptionPlans: [{ ...HOLD_PLAN, destinationAccountId: SAVINGS.id }],
      }),
    );
    const vest = namedCash.find((y) => y.year === VEST_YEAR)!;
    expect(vest.portfolioAssets.cash[SAVINGS.id] ?? 0).toBe(0);
    expect(vest.portfolioAssets.taxable[DEST_ID]).toBeCloseTo(acquiredValue * (1 + GROWTH), 0);
  });

  it("lets the shares keep appreciating instead of freezing as cash", () => {
    // The direct client-facing cost of the old behaviour: cash does not grow.
    const noDestination = runProjection(
      buildData({
        stockOptionPlans: [
          { ...HOLD_PLAN, autoCreateDestination: false, destinationAccountId: null },
        ],
      }),
    );
    const y2030 = noDestination.find((y) => y.year === 2030)!;
    expect(y2030.portfolioAssets.taxable[DEST_ID]).toBeCloseTo(SHARES * fmv(2031), 0);
    // Pre-fix the same position sat at a flat $110,000 inside checking.
    expect(y2030.portfolioAssets.taxable[DEST_ID]).toBeGreaterThan(acquiredValue);
  });

  it("honours a named TAXABLE destination unchanged", () => {
    // Regression guard: only cash destinations are overridden.
    const BROKERAGE: Account = {
      id: "brokerage",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 0,
      basis: 0,
      growthRate: GROWTH,
      rmdEnabled: false,
      realization: {
        pctOrdinaryIncome: 0,
        pctLtCapitalGains: 1,
        pctQualifiedDividends: 0,
        pctTaxExempt: 0,
        turnoverPct: 0,
      },
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const named = runProjection(
      buildData({
        accounts: [CHECKING, SO_ACCOUNT, BROKERAGE],
        stockOptionPlans: [{ ...HOLD_PLAN, destinationAccountId: BROKERAGE.id }],
      }),
    );
    const vest = named.find((y) => y.year === VEST_YEAR)!;
    expect(vest.portfolioAssets.taxable[BROKERAGE.id]).toBeCloseTo(
      acquiredValue * (1 + GROWTH),
      0,
    );
    expect(vest.portfolioAssets.taxable[DEST_ID] ?? 0).toBe(0);
  });
});

// ── F31 × F10 — selling shares the destination can no longer back ───────────
// Now that the destination is a drawdown source (F10), a deficit year can
// liquidate part of it before the plan's scheduled sale. The equity module
// still sells the full share count. Pre-fix the balance was floored at zero
// while the full proceeds were credited to checking — net worth grew by the
// difference. The reconciliation drains what is there and credits only that.

describe("F31 — a raided destination cannot manufacture sale proceeds", () => {
  const DEFICIT_YEAR = 2029;
  const SELL_YEAR = 2031;

  const SELL_PLAN: StockOptionPlan = {
    ...HOLD_PLAN,
    grants: [
      {
        ...HOLD_PLAN.grants[0],
        strategy: { sellTiming: "hold_then_sell_year", sellYear: SELL_YEAR },
      },
    ],
  };
  const BIG_EXPENSE: Expense = {
    id: "exp-big",
    name: "Big one-off",
    annualAmount: 250_000,
    startYear: DEFICIT_YEAR,
    endYear: DEFICIT_YEAR,
    growthRate: 0,
    type: "other",
  };

  const years = runProjection(
    buildData({ expenses: [BIG_EXPENSE], stockOptionPlans: [SELL_PLAN] }),
  );
  const preSell = years.find((y) => y.year === SELL_YEAR - 1)!;
  const sell = years.find((y) => y.year === SELL_YEAR)!;
  const available = preSell.portfolioAssets.taxable[DEST_ID]!;

  it("really is under-funded going into the sale", () => {
    // Fixture guard. The deficit year drew on the destination, so it holds far
    // less than the 1,000 shares the module is about to sell.
    expect(years.find((y) => y.year === DEFICIT_YEAR)!.withdrawals.byAccount[DEST_ID] ?? 0)
      .toBeGreaterThan(0);
    expect(available).toBeGreaterThan(0);
    expect(available).toBeLessThan(SHARES * fmv(SELL_YEAR));
  });

  it("credits only the cash the destination could back", () => {
    // Pre-fix this reported the full $161,051 while the account gave up
    // $72,240 — $88,811 of net worth out of nothing.
    expect(sell.income.bySource[`equity-proceeds:${SO_ID}`]).toBeCloseTo(available, 2);
    expect(sell.portfolioAssets.taxable[DEST_ID] ?? 0).toBeCloseTo(0, 6);
  });

  it("keeps the destination's Portfolio Activity in step with its balance", () => {
    // The ledger distribution must be what the account actually gave up, not
    // the gross sale.
    expect(sell.accountLedgers[DEST_ID]!.distributions).toBeCloseTo(available, 2);
  });
});
