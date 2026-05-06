/**
 * F5 — iterative tax convergence: per-category withdrawal behavior.
 *
 * Each test pins one branch of the new convergence loop. Fixtures use a
 * default-checking account so the new path runs (the legacy no-checking
 * path is unchanged in this PR — see future-work/engine.md).
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type {
  Account,
  ClientData,
  FamilyMember,
  WithdrawalPriority,
} from "../types";

const SINGLE_YEAR_PLAN = {
  ...basePlanSettings,
  planStartYear: 2026,
  planEndYear: 2026,
};

function singleClient(birthYear: number): {
  client: ClientData["client"];
  familyMembers: FamilyMember[];
} {
  return {
    client: {
      ...baseClient,
      dateOfBirth: `${birthYear}-01-01`,
      spouseDob: undefined,
    },
    familyMembers: [
      {
        id: LEGACY_FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Solo",
        lastName: "Test",
        dateOfBirth: `${birthYear}-01-01`,
      },
    ],
  };
}

function buildScenario(opts: {
  birthYear: number;
  accounts: Account[];
  strategyOrder: string[];
  expense: number;
}): ClientData {
  const { client, familyMembers } = singleClient(opts.birthYear);
  const withdrawalStrategy: WithdrawalPriority[] = opts.strategyOrder.map((id, i) => ({
    accountId: id,
    priorityOrder: i + 1,
    startYear: 2026,
    endYear: 2026,
  }));
  return {
    client,
    accounts: opts.accounts,
    incomes: [],
    expenses: [
      {
        id: "exp-living",
        name: "Living",
        type: "living",
        annualAmount: opts.expense,
        growthRate: 0,
        startYear: 2026,
        endYear: 2026,
      },
    ],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy,
    planSettings: SINGLE_YEAR_PLAN,
    familyMembers,
    giftEvents: [],
  };
}

const ownerLegacyClient = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 } as const,
];

const checking = (value: number): Account => ({
  id: "acct-checking",
  name: "Checking",
  category: "cash",
  subType: "checking",
  value,
  basis: value,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: ownerLegacyClient,
});

const savings = (value: number): Account => ({
  id: "acct-savings",
  name: "Savings",
  category: "cash",
  subType: "savings",
  value,
  basis: value,
  growthRate: 0,
  rmdEnabled: false,
  owners: ownerLegacyClient,
});

const taxable = (value: number, basis: number): Account => ({
  id: "acct-taxable",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  value,
  basis,
  growthRate: 0,
  rmdEnabled: false,
  owners: ownerLegacyClient,
});

const tradIra = (value: number): Account => ({
  id: "acct-ira",
  name: "Trad IRA",
  category: "retirement",
  subType: "traditional_ira",
  value,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: ownerLegacyClient,
});

const rothIra = (value: number, basis: number): Account => ({
  id: "acct-roth",
  name: "Roth IRA",
  category: "retirement",
  subType: "roth_ira",
  value,
  basis,
  growthRate: 0,
  rmdEnabled: false,
  owners: ownerLegacyClient,
});

const FLAT_RATE = basePlanSettings.flatFederalRate + basePlanSettings.flatStateRate;

describe("projection: iterative gap-fill (audit F5)", () => {
  it("(a) cash-only deficit produces zero withdrawal tax", () => {
    // $5k checking + $50k savings, $20k expense, no income.
    // Expected: $15k drawn from savings (cash); zero recognized income → zero tax.
    const data = buildScenario({
      birthYear: 1980,
      accounts: [checking(5000), savings(50_000)],
      strategyOrder: ["acct-savings"],
      expense: 20_000,
    });
    const year = runProjection(data)[0];

    expect(year.withdrawals.byAccount["acct-savings"] ?? 0).toBeGreaterThan(0);
    expect(year.expenses.taxes).toBe(0);
    expect(year.taxDetail?.ordinaryIncome ?? 0).toBe(0);
    expect(year.taxDetail?.capitalGains ?? 0).toBe(0);
    // No `withdrawal:` bySource entry on cash-only draw (no recognized income).
    expect(year.taxDetail?.bySource["withdrawal:acct-savings"]).toBeUndefined();
  });

  it("(b) taxable-only deficit produces only LTCG tax on the gain portion", () => {
    // $5k checking, $100k taxable basis $50k (50% gain ratio), $20k expense.
    // Deficit ~$15k → drawn from taxable. Half of each draw is recognized cap gain.
    // Flat-mode tax (no LTCG bracket distinction) = capGains * (flatFed + flatState).
    const data = buildScenario({
      birthYear: 1980,
      accounts: [checking(5000), taxable(100_000, 50_000)],
      strategyOrder: ["acct-taxable"],
      expense: 20_000,
    });
    const year = runProjection(data)[0];

    const draw = year.withdrawals.byAccount["acct-taxable"] ?? 0;
    expect(draw).toBeGreaterThan(0);
    expect(year.taxDetail?.ordinaryIncome ?? 0).toBe(0);
    expect(year.taxDetail?.capitalGains ?? 0).toBeGreaterThan(0);
    // 50% gain ratio: cap gains ≈ draw / 2.
    expect(year.taxDetail!.capitalGains).toBeCloseTo(draw * 0.5, 1);
    // expenses.taxes = capGains * combined flat rate (no penalty).
    expect(year.expenses.taxes).toBeCloseTo(year.taxDetail!.capitalGains * FLAT_RATE, 2);
    // bySource entry for the recognized gain.
    const drillEntry = year.taxDetail?.bySource["withdrawal:acct-taxable"];
    expect(drillEntry?.type).toBe("capital_gains");
  });

  it("(c) Roth basis covers deficit with zero tax", () => {
    // Pre-59.5, Roth basis = value (all contributions, no earnings), $20k deficit.
    // Expected: zero new tax, zero penalty, no withdrawal:bySource entry.
    const data = buildScenario({
      birthYear: 1980, // age 46 in 2026
      accounts: [checking(5000), rothIra(50_000, 50_000)],
      strategyOrder: ["acct-roth"],
      expense: 25_000,
    });
    const year = runProjection(data)[0];

    expect(year.withdrawals.byAccount["acct-roth"] ?? 0).toBeGreaterThan(0);
    expect(year.expenses.taxes).toBe(0);
    expect(year.taxDetail?.ordinaryIncome ?? 0).toBe(0);
    expect(year.taxDetail?.bySource["withdrawal:acct-roth"]).toBeUndefined();
  });

  it("(d) Roth earnings pre-59.5 produces ordinary tax + penalty", () => {
    // Pre-59.5, Roth value $200k basis $5k, deficit ~$20k.
    // Each draw above basis is ordinary income + 10% penalty.
    const data = buildScenario({
      birthYear: 1980,
      accounts: [checking(5000), rothIra(200_000, 5_000)],
      strategyOrder: ["acct-roth"],
      expense: 25_000,
    });
    const year = runProjection(data)[0];

    expect(year.withdrawals.byAccount["acct-roth"] ?? 0).toBeGreaterThan(0);
    expect(year.taxDetail?.ordinaryIncome ?? 0).toBeGreaterThan(0);
    // expenses.taxes includes both income tax AND 10% early-withdrawal penalty.
    // With flat 27% combined rate, total burden is between 27% and 37% of recognized.
    const ord = year.taxDetail!.ordinaryIncome;
    expect(year.expenses.taxes).toBeGreaterThan(ord * FLAT_RATE);
    // Penalty bySource entry exists.
    const penaltyEntry = year.expenses.bySource["withdrawal_penalty:acct-roth"];
    expect(penaltyEntry).toBeGreaterThan(0);
  });

  it("(e) Trad IRA deficit converges to flat-rate-correct taxes", () => {
    // Pre-59.5 Trad IRA deficit. Recognized = full draw amount as ordinary;
    // tax = ordinary * combined flat rate; plus 10% penalty.
    const data = buildScenario({
      birthYear: 1980,
      accounts: [checking(5000), tradIra(500_000)],
      strategyOrder: ["acct-ira"],
      expense: 50_000,
    });
    const year = runProjection(data)[0];

    const draw = year.withdrawals.byAccount["acct-ira"] ?? 0;
    expect(draw).toBeGreaterThan(0);
    // Full draw is ordinary income.
    expect(year.taxDetail?.ordinaryIncome ?? 0).toBeCloseTo(draw, 0);
    // Penalty is 10% of the draw.
    const penaltyEntry = year.expenses.bySource["withdrawal_penalty:acct-ira"] ?? 0;
    expect(penaltyEntry).toBeCloseTo(draw * 0.1, 1);
    // expenses.taxes ≈ ord * 27% + ord * 10% (flat-mode tax + penalty).
    expect(year.expenses.taxes).toBeCloseTo(draw * (FLAT_RATE + 0.1), 0);
  });

  it("(f) drill-down invariant: bySource ordinary entries sum to taxDetail.ordinaryIncome", () => {
    // Mixed deficit: cash (no income) + Trad IRA (ordinary income).
    // Sum of bySource entries with type=ordinary_income equals taxDetail.ordinaryIncome.
    const data = buildScenario({
      birthYear: 1980,
      accounts: [checking(5000), savings(20_000), tradIra(500_000)],
      strategyOrder: ["acct-savings", "acct-ira"],
      expense: 60_000,
    });
    const year = runProjection(data)[0];

    const ordEntries = Object.values(year.taxDetail?.bySource ?? {})
      .filter((e) => e.type === "ordinary_income")
      .reduce((sum, e) => sum + e.amount, 0);
    expect(ordEntries).toBeCloseTo(year.taxDetail!.ordinaryIncome, 1);
  });

  it("(g) expenses.taxes equals taxResult totalTax + supplemental early-withdrawal penalty", () => {
    // Penalty-bearing scenario: pre-59.5 Trad deficit. Reconcile expenses.taxes
    // with taxResult.flow.totalTax + the supplemental penalty surfaced via bySource.
    const data = buildScenario({
      birthYear: 1980,
      accounts: [checking(5000), tradIra(500_000)],
      strategyOrder: ["acct-ira"],
      expense: 40_000,
    });
    const year = runProjection(data)[0];

    const totalTax = year.taxResult!.flow.totalTax;
    const penalty = year.expenses.bySource["withdrawal_penalty:acct-ira"] ?? 0;
    expect(year.expenses.taxes).toBeCloseTo(totalTax + penalty, 1);
  });

  it("(h) convergence within 5 iterations on a synthetic worst case", () => {
    // High deficit + early-withdrawal penalty case that exercises iteration but
    // should still converge within MAX_ITER. Asserts no engine_iteration_limit warning.
    const data = buildScenario({
      birthYear: 1980,
      accounts: [checking(5000), tradIra(500_000)],
      strategyOrder: ["acct-ira"],
      expense: 80_000,
    });
    const year = runProjection(data)[0];

    const limitWarning = (year.trustWarnings ?? []).find(
      (w) => w.code === "engine_iteration_limit",
    );
    expect(limitWarning).toBeUndefined();
  });

  it("(i) household checking ledger nets income, expenses, and tax to a single signed entry", () => {
    // Surplus year: $200k salary - $100k expense - tax ≈ +$46k net into checking.
    // Pre-fix bug: pre-tax flows post as a $100k contribution and tax posts as
    // a separate $54k distribution, so Portfolio Activity reports $100k of
    // additions to cash even though the cash ledger only grew by $46k.
    // Post-fix: contributions and distributions for the household checking are
    // mutually exclusive — one is zero, the other equals |net flow|.
    const { client, familyMembers } = singleClient(1970);
    const data: ClientData = {
      client,
      accounts: [checking(50_000)],
      incomes: [
        {
          id: "inc-salary",
          type: "salary",
          name: "Salary",
          annualAmount: 200_000,
          startYear: 2026,
          endYear: 2026,
          growthRate: 0,
          owner: "client",
        },
      ],
      expenses: [
        {
          id: "exp-living",
          name: "Living",
          type: "living",
          annualAmount: 100_000,
          growthRate: 0,
          startYear: 2026,
          endYear: 2026,
        },
      ],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: SINGLE_YEAR_PLAN,
      familyMembers,
      giftEvents: [],
    };
    const year = runProjection(data)[0];

    const ledger = year.accountLedgers["acct-checking"];
    expect(ledger).toBeDefined();

    // Sanity: tax was actually charged (otherwise the test wouldn't exercise the bug).
    expect(year.expenses.taxes).toBeGreaterThan(0);

    // Net change = ending - beginning matches contributions - distributions.
    const netLedger = ledger.contributions - ledger.distributions;
    const netBalance = ledger.endingValue - ledger.beginningValue;
    expect(netLedger).toBeCloseTo(netBalance, 2);

    // Single signed entry: either all contribution (surplus) or all distribution
    // (deficit), never both. Pre-fix this assertion fails because tax posts as
    // a separate distribution alongside a positive contribution.
    const bothNonZero = ledger.contributions > 0.01 && ledger.distributions > 0.01;
    expect(bothNonZero).toBe(false);
  });

  it("(j) supplemental withdrawal attributes external distribution to the source account, not cash", () => {
    // Deficit year: $10k expense, $5k cash, $20k brokerage. Engine pulls ~$5k
    // supplemental from the brokerage to refill cash. The supplemental amount
    // should surface as an external distribution on the brokerage (so Portfolio
    // Activity shows the funding source), and cash's external distribution
    // should drop by the pass-through amount (so the same dollars aren't
    // double-counted).
    const data = buildScenario({
      birthYear: 1955,
      accounts: [checking(5_000), taxable(20_000, 20_000)],
      strategyOrder: ["acct-taxable"],
      expense: 10_000,
    });
    const year = runProjection(data)[0];

    const supplementalTotal = year.withdrawals.byAccount["acct-taxable"] ?? 0;
    expect(supplementalTotal).toBeGreaterThan(0);

    const brokerage = year.accountLedgers["acct-taxable"];
    const cash = year.accountLedgers["acct-checking"];
    expect(brokerage).toBeDefined();
    expect(cash).toBeDefined();

    // Source: external distribution = supplemental amount, no longer hidden as internal.
    expect(brokerage.distributions - brokerage.internalDistributions).toBeCloseTo(supplementalTotal, 2);
    expect(brokerage.internalDistributions).toBe(0);

    // Cash: refill credit AND matching pass-through debit are both internal so the
    // supplemental flow nets out of cash's external activity.
    expect(cash.internalContributions).toBeCloseTo(supplementalTotal, 2);
    expect(cash.internalDistributions).toBeCloseTo(supplementalTotal, 2);
  });

  it("cash drawdown reporting includes the tax portion of the year's drain", () => {
    // Surplus pre-tax year that's pulled into a drawdown by the tax bill —
    // mirrors the user-reported case where the Cash Assets withdrawal column
    // under-reported the year's cash drain by exactly the federal+state tax.
    //
    // Setup: $100k checking, $100k salary, $80k expense, no other accounts.
    // Pre-tax flow:  +100k income – 80k expense = +20k → checking 120k
    // Tax (27% flat on 100k earned) = $27k → ending 93k
    // True consumed of BoY 100k = 7k.
    const data: ClientData = {
      ...buildScenario({
        birthYear: 1980,
        accounts: [checking(100_000)],
        strategyOrder: [],
        expense: 80_000,
      }),
      incomes: [
        {
          id: "inc-salary",
          type: "salary",
          name: "Salary",
          annualAmount: 100_000,
          startYear: 2026,
          endYear: 2026,
          growthRate: 0,
          owner: "client",
        },
      ],
    };
    const year = runProjection(data)[0];

    const cashDrawdown = year.withdrawals.byAccount["acct-checking"] ?? 0;
    // Drawdown must include the tax: 27% of $100k earned = $27k. Combined with
    // the +$20k pre-tax surplus, the BoY checking lost $7k.
    expect(year.expenses.taxes).toBeCloseTo(27_000, 0);
    expect(cashDrawdown).toBeCloseTo(7_000, 0);
    // Total withdrawals reported = same value (only cash was drawn).
    expect(year.withdrawals.total).toBeCloseTo(7_000, 0);
  });
});
