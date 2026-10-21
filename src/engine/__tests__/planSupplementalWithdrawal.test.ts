// src/engine/__tests__/planSupplementalWithdrawal.test.ts
import { describe, it, expect } from "vitest";
import { planSupplementalWithdrawal, isHsaWithdrawalLocked } from "../withdrawal";
import type { Account, WithdrawalPriority } from "../types";

const acct = (id: string, overrides: Partial<Account>): Account => ({
  id, name: id, category: "cash", subType: "savings", titlingType: "jtwros",
  value: 0, basis: 0, growthRate: 0, rmdEnabled: false, owners: [],
  ...overrides,
});

describe("planSupplementalWithdrawal", () => {
  it("returns empty plan for zero shortfall", () => {
    const plan = planSupplementalWithdrawal({
      shortfall: 0, strategy: [], householdBalances: {}, basisMap: {},
      accounts: [], ages: { client: 50, spouse: null }, isSpouseAccount: () => false, year: 2026,
    });
    expect(plan.total).toBe(0);
    expect(plan.draws).toEqual([]);
    expect(plan.recognizedIncome).toEqual({ ordinaryIncome: 0, capitalGains: 0, earlyWithdrawalPenalty: 0 });
  });

  it("pulls from highest-priority account first", () => {
    const accounts = [
      acct("a-tax", { category: "taxable", subType: "brokerage", value: 100_000, basis: 40_000 }),
      acct("a-trad", { category: "retirement", subType: "traditional_ira", value: 100_000 }),
    ];
    const strategy: WithdrawalPriority[] = [
      { accountId: "a-tax", priorityOrder: 1, startYear: 2020, endYear: 2099 },
      { accountId: "a-trad", priorityOrder: 2, startYear: 2020, endYear: 2099 },
    ];
    const plan = planSupplementalWithdrawal({
      shortfall: 10_000, strategy,
      householdBalances: { "a-tax": 100_000, "a-trad": 100_000 },
      basisMap: { "a-tax": 40_000, "a-trad": 0 },
      accounts, ages: { client: 50, spouse: null }, isSpouseAccount: () => false, year: 2026,
    });
    expect(plan.total).toBe(10_000);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0].accountId).toBe("a-tax");
    expect(plan.recognizedIncome.capitalGains).toBeCloseTo(6_000, 6); // 60% gain ratio × 10k
    expect(plan.recognizedIncome.ordinaryIncome).toBe(0);
  });

  it("spills to next priority when first account exhausted, aggregates recognized income", () => {
    const accounts = [
      acct("a-cash", { category: "cash", subType: "money_market", value: 5_000 }),
      acct("a-trad", { category: "retirement", subType: "traditional_ira", value: 100_000 }),
    ];
    const strategy: WithdrawalPriority[] = [
      { accountId: "a-cash", priorityOrder: 1, startYear: 2020, endYear: 2099 },
      { accountId: "a-trad", priorityOrder: 2, startYear: 2020, endYear: 2099 },
    ];
    const plan = planSupplementalWithdrawal({
      shortfall: 15_000, strategy,
      householdBalances: { "a-cash": 5_000, "a-trad": 100_000 },
      basisMap: {}, accounts,
      ages: { client: 65, spouse: null }, isSpouseAccount: () => false, year: 2026,
    });
    expect(plan.total).toBe(15_000);
    expect(plan.byAccount["a-cash"]).toBe(5_000);
    expect(plan.byAccount["a-trad"]).toBe(10_000);
    expect(plan.recognizedIncome.ordinaryIncome).toBe(10_000); // only Trad portion
    expect(plan.recognizedIncome.earlyWithdrawalPenalty).toBe(0); // post-59.5
  });

  it("respects strategy year-range filtering", () => {
    const accounts = [acct("a-tax", { category: "taxable", subType: "brokerage", value: 100_000 })];
    const strategy: WithdrawalPriority[] = [
      { accountId: "a-tax", priorityOrder: 1, startYear: 2030, endYear: 2099 },
    ];
    const plan = planSupplementalWithdrawal({
      shortfall: 10_000, strategy,
      householdBalances: { "a-tax": 100_000 }, basisMap: {}, accounts,
      ages: { client: 50, spouse: null }, isSpouseAccount: () => false, year: 2026, // before strategy start
    });
    expect(plan.total).toBe(0); // strategy entry not yet active
  });

  it("uses spouse age for spouse-owned accounts", () => {
    const accounts = [
      acct("a-trad", { category: "retirement", subType: "traditional_ira", value: 100_000 }),
    ];
    const strategy: WithdrawalPriority[] = [
      { accountId: "a-trad", priorityOrder: 1, startYear: 2020, endYear: 2099 },
    ];
    // Client age 50 (would penalty), spouse age 65 (no penalty); account is spouse-owned
    const plan = planSupplementalWithdrawal({
      shortfall: 10_000, strategy,
      householdBalances: { "a-trad": 100_000 }, basisMap: {}, accounts,
      ages: { client: 50, spouse: 65 }, isSpouseAccount: (a) => a.id === "a-trad", year: 2026,
    });
    expect(plan.draws[0].earlyWithdrawalPenalty).toBe(0); // spouse age 65 — no penalty
  });

  it("caps each draw at the available household balance", () => {
    const accounts = [acct("a-trad", { category: "retirement", subType: "traditional_ira", value: 200_000 })];
    const strategy: WithdrawalPriority[] = [
      { accountId: "a-trad", priorityOrder: 1, startYear: 2020, endYear: 2099 },
    ];
    const plan = planSupplementalWithdrawal({
      shortfall: 10_000, strategy,
      householdBalances: { "a-trad": 3_000 }, // only 3k tappable
      basisMap: {}, accounts,
      ages: { client: 65, spouse: null }, isSpouseAccount: () => false, year: 2026,
    });
    expect(plan.total).toBe(3_000);
    expect(plan.recognizedIncome.ordinaryIncome).toBe(3_000);
  });

  it("taxable: gain ratio uses live householdBalances, not the stale Account.value snapshot", () => {
    // Account was originally created with value=100k. Several years of LTCG
    // appreciation later, the live balance is 200k while basis stayed at 50k.
    // Correct gain ratio = 1 − 50/200 = 75%, NOT 1 − 50/100 = 50%.
    const accounts = [
      acct("a-tax", { category: "taxable", subType: "brokerage", value: 100_000, basis: 50_000 }),
    ];
    const strategy: WithdrawalPriority[] = [
      { accountId: "a-tax", priorityOrder: 1, startYear: 2020, endYear: 2099 },
    ];
    const plan = planSupplementalWithdrawal({
      shortfall: 40_000,
      strategy,
      householdBalances: { "a-tax": 200_000 }, // live balance after years of growth
      basisMap: { "a-tax": 50_000 },
      accounts,
      ages: { client: 65, spouse: null },
      isSpouseAccount: () => false,
      year: 2030,
    });
    expect(plan.total).toBe(40_000);
    // 40_000 × (1 − 50/200) = 40_000 × 0.75 = 30_000
    expect(plan.recognizedIncome.capitalGains).toBeCloseTo(30_000, 6);
  });
});

describe("HSA 65 gate", () => {
  const hsa = acct("h1", { category: "retirement", subType: "hsa", value: 100_000 });
  const ira = acct("i1", { category: "retirement", subType: "traditional_ira", value: 100_000 });

  it("locks an HSA before 65", () => {
    expect(isHsaWithdrawalLocked(hsa, 64)).toBe(true);
  });
  it("unlocks an HSA at 65", () => {
    expect(isHsaWithdrawalLocked(hsa, 65)).toBe(false);
  });
  it("never locks a non-HSA account", () => {
    expect(isHsaWithdrawalLocked(ira, 40)).toBe(false);
  });

  it("skips a pre-65 HSA in the supplemental plan and draws the IRA instead", () => {
    const accounts = [hsa, ira];
    const plan = planSupplementalWithdrawal({
      shortfall: 5000,
      strategy: [
        { accountId: "h1", priorityOrder: 1, startYear: 2026, endYear: 2099 },
        { accountId: "i1", priorityOrder: 2, startYear: 2026, endYear: 2099 },
      ],
      householdBalances: { h1: 100000, i1: 100000 },
      basisMap: {},
      accounts,
      ages: { client: 64, spouse: null },
      isSpouseAccount: () => false,
      year: 2026,
    });
    expect(plan.byAccount.h1 ?? 0).toBe(0);
    expect(plan.byAccount.i1).toBeCloseTo(5000, 2);
  });

  it("draws a 65-year-old's HSA tax-free", () => {
    const plan = planSupplementalWithdrawal({
      shortfall: 5000,
      strategy: [{ accountId: "h1", priorityOrder: 1, startYear: 2026, endYear: 2099 }],
      householdBalances: { h1: 100000 },
      basisMap: {},
      accounts: [hsa],
      ages: { client: 65, spouse: null },
      isSpouseAccount: () => false,
      year: 2026,
    });
    expect(plan.byAccount.h1).toBeCloseTo(5000, 2);
    expect(plan.recognizedIncome.ordinaryIncome).toBe(0);
    expect(plan.recognizedIncome.earlyWithdrawalPenalty).toBe(0);
  });
});

describe("planSupplementalWithdrawal — margined account (spec 2026-10-13)", () => {
  it("draws stop at a margined account's net value", () => {
    const accounts = [acct("m", { category: "taxable", subType: "brokerage", value: 10_000_000, basis: 9_000_000 })];
    const strategy: WithdrawalPriority[] = [
      { accountId: "m", priorityOrder: 1, startYear: 2026, endYear: 2060 },
    ];
    const plan = planSupplementalWithdrawal({
      shortfall: 9_000_000, strategy,
      householdBalances: { m: 8_000_000 }, grossBalances: { m: 10_000_000 },
      basisMap: { m: 9_000_000 }, accounts,
      ages: { client: 65, spouse: null }, isSpouseAccount: () => false, year: 2026,
    });
    expect(plan.byAccount.m).toBeCloseTo(8_000_000, 2);
    expect(plan.recognizedIncome.capitalGains).toBeCloseTo(800_000, 2); // 8M × (1 − 9/10)
  });
});

describe("planSupplementalWithdrawal — a margined account sells only down to its call level", () => {
  // $8M net + $2M loan, $9M basis, 30% call level. Selling $5M/0.7 ≈ $7.14M
  // leaves net at 30% of the securities; the $857K below that line is drawn
  // only once every other source is empty.
  const m = acct("m", { category: "taxable", subType: "brokerage", value: 10_000_000, basis: 9_000_000, marginCallPct: 0.3 });
  const t = acct("t", { category: "taxable", subType: "brokerage", value: 5_000_000, basis: 5_000_000 });
  const input = {
    strategy: [
      { accountId: "m", priorityOrder: 1, startYear: 2026, endYear: 2060 },
      { accountId: "t", priorityOrder: 2, startYear: 2026, endYear: 2060 },
    ] as WithdrawalPriority[],
    accounts: [m, t],
    householdBalances: { m: 8_000_000, t: 5_000_000 },
    grossBalances: { m: 10_000_000 },
    marginLoans: { m: 2_000_000 },
    basisMap: { m: 9_000_000, t: 5_000_000 },
    ages: { client: 65, spouse: null }, isSpouseAccount: () => false, year: 2026,
  };
  const FREE = 5_000_000 / 0.7;

  it("stops at the call level and moves on to the next source", () => {
    const plan = planSupplementalWithdrawal({ ...input, shortfall: 9_000_000 });
    expect(plan.byAccount.m).toBeCloseTo(FREE, 2);
    expect(plan.byAccount.t).toBeCloseTo(9_000_000 - FREE, 2);
    expect(plan.recognizedIncome.capitalGains).toBeCloseTo(FREE * 0.1, 2); // securities ratio 1 − 9/10
  });

  it("draws the equity below the call level last, after every other source", () => {
    const plan = planSupplementalWithdrawal({ ...input, shortfall: 12_500_000 });
    expect(plan.byAccount).toEqual({ m: expect.closeTo(7_500_000, 2), t: expect.closeTo(5_000_000, 2) });
    expect(plan.draws.filter((d) => d.accountId === "m")).toHaveLength(1);
    expect(plan.recognizedIncome.capitalGains).toBeCloseTo(750_000, 2);
  });

  it("never draws past net value, even as the last resort", () => {
    const plan = planSupplementalWithdrawal({ ...input, shortfall: 20_000_000 });
    expect(plan.byAccount).toEqual({ m: expect.closeTo(8_000_000, 2), t: expect.closeTo(5_000_000, 2) });
  });

  it("a borrow on the same account counts toward the call level", () => {
    // Borrowing $50K takes net to $500K against a $500K loan: the sale stops at
    // (500K − 0.3 × 1M) / 0.7 and the second account covers the rest.
    const tax = acct("a-tax", { category: "taxable", subType: "brokerage", value: 1_000_000, basis: 400_000 });
    const tax2 = acct("a-tax2", { category: "taxable", subType: "brokerage", value: 1_000_000, basis: 1_000_000 });
    const plan = planSupplementalWithdrawal({
      shortfall: 1_000_000, accounts: [tax, tax2],
      strategy: [
        { accountId: "a-tax", priorityOrder: 1, startYear: 2020, endYear: 2099 },
        { accountId: "a-tax2", priorityOrder: 2, startYear: 2020, endYear: 2099 },
      ],
      householdBalances: { "a-tax": 550_000, "a-tax2": 1_000_000 },
      grossBalances: { "a-tax": 1_000_000 }, marginLoans: { "a-tax": 450_000 },
      marginBorrowSources: [{ accountId: "a-tax", headroom: 50_000, rate: 0.08 }],
      basisMap: { "a-tax": 400_000, "a-tax2": 1_000_000 },
      ages: { client: 60, spouse: null }, isSpouseAccount: () => false, year: 2026,
    });
    expect(plan.borrowedByAccount).toEqual({ "a-tax": 50_000 });
    expect(plan.byAccount["a-tax"]).toBeCloseTo(200_000 / 0.7, 2);
    expect(plan.byAccount["a-tax2"]).toBeCloseTo(950_000 - 200_000 / 0.7, 2);
  });
});

describe("borrowing on margin (spec 2026-10-14)", () => {
  const base = {
    basisMap: { "a-tax": 400_000 }, ages: { client: 60, spouse: null }, isSpouseAccount: () => false, year: 2026,
  };
  const tax = acct("a-tax", { category: "taxable", subType: "brokerage", value: 1_000_000, basis: 400_000 });
  const cash = acct("a-cash", { category: "cash", subType: "savings", value: 30_000 });
  const row = (accountId: string, priorityOrder: number) => ({ accountId, priorityOrder, startYear: 2020, endYear: 2099 });

  it("borrows after cash and before the first non-cash source (default order)", () => {
    const plan = planSupplementalWithdrawal({ ...base, shortfall: 100_000,
      strategy: [row("a-cash", 1), row("a-tax", 2)], accounts: [cash, tax],
      householdBalances: { "a-cash": 30_000, "a-tax": 1_000_000 },
      marginBorrowSources: [{ accountId: "a-tax", headroom: 500_000, rate: 0.08 }] });
    expect(plan.byAccount).toEqual({ "a-cash": 30_000 });
    expect(plan.borrowedByAccount).toEqual({ "a-tax": 70_000 });
    expect(plan.total).toBe(100_000);
    expect(plan.recognizedIncome).toEqual({ ordinaryIncome: 0, capitalGains: 0, earlyWithdrawalPenalty: 0 });
    expect(plan.draws.find((d) => d.borrowed)).toEqual({ accountId: "a-tax", amount: 70_000,
      ordinaryIncome: 0, capitalGains: 0, basisReturn: 0, earlyWithdrawalPenalty: 0, borrowed: true });
  });

  it("a custom order with cash later borrows before cash", () => {
    const plan = planSupplementalWithdrawal({ ...base, shortfall: 100_000,
      strategy: [row("a-tax", 1), row("a-cash", 2)], accounts: [cash, tax],
      householdBalances: { "a-cash": 30_000, "a-tax": 1_000_000 },
      marginBorrowSources: [{ accountId: "a-tax", headroom: 500_000, rate: 0.08 }] });
    expect(plan.borrowedByAccount).toEqual({ "a-tax": 100_000 });
    expect(plan.byAccount).toEqual({});
  });

  it("an all-cash order borrows after the cash runs out", () => {
    const plan = planSupplementalWithdrawal({ ...base, shortfall: 100_000,
      strategy: [row("a-cash", 1)], accounts: [cash, tax],
      householdBalances: { "a-cash": 30_000, "a-tax": 1_000_000 },
      marginBorrowSources: [{ accountId: "a-tax", headroom: 500_000, rate: 0.08 }] });
    expect(plan.byAccount).toEqual({ "a-cash": 30_000 });
    expect(plan.borrowedByAccount).toEqual({ "a-tax": 70_000 });
  });

  it("a sell after a borrow on the same account uses the pre-borrow securities value (Review Focus 1)", () => {
    // No loan yet, so no grossBalances entry: the sell's ratio must use the
    // 1,000,000 of securities, not the 980,000 of net left after borrowing.
    const plan = planSupplementalWithdrawal({ ...base, shortfall: 100_000,
      strategy: [row("a-tax", 1)], accounts: [tax],
      householdBalances: { "a-tax": 1_000_000 },
      marginBorrowSources: [{ accountId: "a-tax", headroom: 20_000, rate: 0.08 }] });
    expect(plan.borrowedByAccount).toEqual({ "a-tax": 20_000 });
    expect(plan.byAccount).toEqual({ "a-tax": 80_000 });
    expect(plan.recognizedIncome.capitalGains).toBeCloseTo(80_000 * 0.6, 6);
  });

  it("the sell row sees net less what was borrowed", () => {
    const plan = planSupplementalWithdrawal({ ...base, shortfall: 1_000_000,
      strategy: [row("a-tax", 1)], accounts: [tax],
      householdBalances: { "a-tax": 550_000 }, grossBalances: { "a-tax": 1_000_000 },
      marginBorrowSources: [{ accountId: "a-tax", headroom: 50_000, rate: 0.08 }] });
    expect(plan.borrowedByAccount).toEqual({ "a-tax": 50_000 });
    expect(plan.byAccount).toEqual({ "a-tax": 500_000 });
  });

  it("walks the sources in the order given", () => {
    const tax2 = acct("a-tax2", { category: "taxable", subType: "brokerage", value: 1_000_000 });
    const plan = planSupplementalWithdrawal({ ...base, shortfall: 100_000,
      strategy: [row("a-tax", 1), row("a-tax2", 2)], accounts: [tax, tax2],
      householdBalances: { "a-tax": 1_000_000, "a-tax2": 1_000_000 },
      marginBorrowSources: [{ accountId: "a-tax2", headroom: 60_000, rate: 0.06 }, { accountId: "a-tax", headroom: 500_000, rate: 0.08 }] });
    expect(plan.borrowedByAccount).toEqual({ "a-tax2": 60_000, "a-tax": 40_000 });
  });

  it("with no sources the plan is exactly the pre-Phase-2 plan", () => {
    const input = { ...base, shortfall: 100_000, strategy: [row("a-cash", 1), row("a-tax", 2)], accounts: [cash, tax],
      householdBalances: { "a-cash": 30_000, "a-tax": 1_000_000 } };
    expect(planSupplementalWithdrawal({ ...input, marginBorrowSources: [] })).toEqual(planSupplementalWithdrawal(input));
    expect("borrowedByAccount" in planSupplementalWithdrawal(input)).toBe(false);
  });
});
