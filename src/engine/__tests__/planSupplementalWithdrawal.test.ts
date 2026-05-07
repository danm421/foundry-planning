// src/engine/__tests__/planSupplementalWithdrawal.test.ts
import { describe, it, expect } from "vitest";
import { planSupplementalWithdrawal } from "../withdrawal";
import type { Account, WithdrawalPriority } from "../types";

const acct = (id: string, overrides: Partial<Account>): Account => ({
  id, name: id, category: "cash", subType: "savings",
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
