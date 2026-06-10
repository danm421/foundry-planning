import { describe, it, expect } from "vitest";
import { applyTransfers } from "../transfers";
import type { Account, Transfer, AccountLedger } from "../types";

function makeLedger(value: number): AccountLedger {
  return {
    beginningValue: value, growth: 0, contributions: 0, distributions: 0,
    internalContributions: 0, internalDistributions: 0,
    rmdAmount: 0, fees: 0, endingValue: value, entries: [],
  };
}

const iraAccount: Account = {
  id: "ira-1", name: "Traditional IRA", category: "retirement", subType: "traditional_ira",
  titlingType: "jtwros",
  value: 500000, basis: 0, growthRate: 0.07, rmdEnabled: true, owners: [],
};

const rothAccount: Account = {
  id: "roth-1", name: "Roth IRA", category: "retirement", subType: "roth_ira",
  titlingType: "jtwros",
  value: 100000, basis: 60000, growthRate: 0.07, rmdEnabled: false, owners: [],
};

const checkingAccount: Account = {
  id: "checking-1", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros",
  value: 50000, basis: 50000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true, owners: [],
};

const brokerageAccount: Account = {
  id: "brokerage-1", name: "Brokerage", category: "taxable", subType: "brokerage",
  titlingType: "jtwros",
  value: 200000, basis: 100000, growthRate: 0.07, rmdEnabled: false, owners: [],
};

describe("applyTransfers", () => {
  it("executes a one-time Roth conversion", () => {
    const transfers: Transfer[] = [{
      id: "t1", name: "Roth Conversion", sourceAccountId: "ira-1", targetAccountId: "roth-1",
      amount: 50000, mode: "one_time", startYear: 2028, growthRate: 0, schedules: [],
    }];
    const balances: Record<string, number> = { "ira-1": 500000, "roth-1": 100000 };
    const basisMap: Record<string, number> = { "ira-1": 0, "roth-1": 60000 };
    const ledgers: Record<string, AccountLedger> = { "ira-1": makeLedger(500000), "roth-1": makeLedger(100000) };

    const result = applyTransfers({
      transfers, accounts: [iraAccount, rothAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 65 },
    });

    expect(balances["ira-1"]).toBe(450000);
    expect(balances["roth-1"]).toBe(150000);
    expect(result.taxableOrdinaryIncome).toBe(50000);
    expect(result.capitalGains).toBe(0);
    expect(result.earlyWithdrawalPenalty).toBe(0);
  });

  it("skips transfers outside their active year", () => {
    const transfers: Transfer[] = [{
      id: "t1", name: "Future Transfer", sourceAccountId: "ira-1", targetAccountId: "roth-1",
      amount: 50000, mode: "one_time", startYear: 2030, growthRate: 0, schedules: [],
    }];
    const balances: Record<string, number> = { "ira-1": 500000, "roth-1": 100000 };
    const basisMap: Record<string, number> = { "ira-1": 0, "roth-1": 60000 };
    const ledgers: Record<string, AccountLedger> = { "ira-1": makeLedger(500000), "roth-1": makeLedger(100000) };

    const result = applyTransfers({
      transfers, accounts: [iraAccount, rothAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 63 },
    });

    expect(balances["ira-1"]).toBe(500000);
    expect(result.taxableOrdinaryIncome).toBe(0);
  });

  it("applies growth rate to recurring transfers", () => {
    const transfers: Transfer[] = [{
      id: "t1", name: "Annual Conversion", sourceAccountId: "ira-1", targetAccountId: "roth-1",
      amount: 50000, mode: "recurring", startYear: 2026, endYear: 2035, growthRate: 0.03, schedules: [],
    }];
    const balances: Record<string, number> = { "ira-1": 500000, "roth-1": 100000 };
    const basisMap: Record<string, number> = { "ira-1": 0, "roth-1": 60000 };
    const ledgers: Record<string, AccountLedger> = { "ira-1": makeLedger(500000), "roth-1": makeLedger(100000) };

    const result = applyTransfers({
      transfers, accounts: [iraAccount, rothAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 65 },
    });

    const expected = 50000 * Math.pow(1.03, 2); // 2 years of growth
    expect(balances["ira-1"]).toBeCloseTo(500000 - expected, 0);
    expect(result.taxableOrdinaryIncome).toBeCloseTo(expected, 0);
  });

  it("uses schedule override amounts", () => {
    const transfers: Transfer[] = [{
      id: "t1", name: "Custom Schedule", sourceAccountId: "ira-1", targetAccountId: "roth-1",
      amount: 50000, mode: "scheduled", startYear: 2026, endYear: 2030, growthRate: 0,
      schedules: [{ year: 2026, amount: 30000 }, { year: 2028, amount: 75000 }],
    }];
    const balances: Record<string, number> = { "ira-1": 500000, "roth-1": 100000 };
    const basisMap: Record<string, number> = { "ira-1": 0, "roth-1": 60000 };
    const ledgers: Record<string, AccountLedger> = { "ira-1": makeLedger(500000), "roth-1": makeLedger(100000) };

    const result = applyTransfers({
      transfers, accounts: [iraAccount, rothAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 65 },
    });

    expect(balances["ira-1"]).toBe(425000);
    expect(result.taxableOrdinaryIncome).toBe(75000);
  });

  it("skips scheduled year with no override entry", () => {
    const transfers: Transfer[] = [{
      id: "t1", name: "Sparse Schedule", sourceAccountId: "ira-1", targetAccountId: "roth-1",
      amount: 50000, mode: "scheduled", startYear: 2026, endYear: 2030, growthRate: 0,
      schedules: [{ year: 2026, amount: 30000 }],
    }];
    const balances: Record<string, number> = { "ira-1": 500000, "roth-1": 100000 };
    const basisMap: Record<string, number> = { "ira-1": 0, "roth-1": 60000 };
    const ledgers: Record<string, AccountLedger> = { "ira-1": makeLedger(500000), "roth-1": makeLedger(100000) };

    const result = applyTransfers({
      transfers, accounts: [iraAccount, rothAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2027, ownerAges: { client: 64 },
    });

    expect(balances["ira-1"]).toBe(500000);
    expect(result.taxableOrdinaryIncome).toBe(0);
  });

  it("caps transfer at source account balance", () => {
    const transfers: Transfer[] = [{
      id: "t1", name: "Over-Transfer", sourceAccountId: "ira-1", targetAccountId: "roth-1",
      amount: 600000, mode: "one_time", startYear: 2028, growthRate: 0, schedules: [],
    }];
    const balances: Record<string, number> = { "ira-1": 500000, "roth-1": 100000 };
    const basisMap: Record<string, number> = { "ira-1": 0, "roth-1": 60000 };
    const ledgers: Record<string, AccountLedger> = { "ira-1": makeLedger(500000), "roth-1": makeLedger(100000) };

    applyTransfers({
      transfers, accounts: [iraAccount, rothAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 65 },
    });

    expect(balances["ira-1"]).toBe(0);
    expect(balances["roth-1"]).toBe(600000);
  });

  it("treats a Roth → cash transfer as contributions-first when source has basis (F2)", () => {
    // Roth basis = $60k, value = $100k, withdraw $50k pre-59.5.
    // Amount <= basis → fully tax-free. Target basis = 0 to expose the pre-fix bug.
    const transfers: Transfer[] = [{
      id: "t1", name: "Roth to checking", sourceAccountId: "roth-1",
      targetAccountId: "checking-1", amount: 50000, mode: "one_time",
      startYear: 2028, growthRate: 0, schedules: [],
    }];
    const balances: Record<string, number> = { "roth-1": 100000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "roth-1": 60000, "checking-1": 0 };
    const ledgers: Record<string, AccountLedger> = {
      "roth-1": makeLedger(100000),
      "checking-1": makeLedger(50000),
    };

    const result = applyTransfers({
      transfers, accounts: [rothAccount, checkingAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 50 },
    });

    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.earlyWithdrawalPenalty).toBe(0);
    expect(balances["roth-1"]).toBe(50000);
    expect(balances["checking-1"]).toBe(100000);
  });

  it("decrements Roth source basis contributions-first, not pro-rata (BUG #11)", () => {
    // Roth value $100k / basis $60k. Transfer $50k to checking pre-59.5.
    // Tax math (_classifyRothDistribution) consumes basis FIRST: $50k <= $60k → tax-free.
    // Basis map must mirror that: remaining Roth basis = 60k − 50k = 10k (NOT the
    // pro-rata residual 60k × (1 − 50k/100k) = 30k). Conserved basis lands on the
    // cash target as ordinary cost basis: 0 + 50k = 50k (NOT the pro-rata 30k).
    const transfers: Transfer[] = [{
      id: "t1", name: "Roth to checking", sourceAccountId: "roth-1",
      targetAccountId: "checking-1", amount: 50000, mode: "one_time",
      startYear: 2028, growthRate: 0, schedules: [],
    }];
    const balances: Record<string, number> = { "roth-1": 100000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "roth-1": 60000, "checking-1": 0 };
    const ledgers: Record<string, AccountLedger> = {
      "roth-1": makeLedger(100000),
      "checking-1": makeLedger(50000),
    };

    applyTransfers({
      transfers, accounts: [rothAccount, checkingAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 50 },
    });

    expect(basisMap["roth-1"]).toBe(10000); // 60k − 50k, NOT 30k pro-rata residual
    expect(basisMap["checking-1"]).toBe(50000); // conserved, NOT 30k
  });

  it("downstream pre-59.5 Roth transfer taxes earnings once basis is truly drained (BUG #11)", () => {
    // After a $50k contributions-first transfer the Roth has value $50k / basis $10k.
    // A follow-on $30k Roth→cash transfer pre-59.5 should read true remaining basis
    // ($10k), taxing $20k of earnings as OI with a $2k (10%) penalty. With the old
    // pro-rata residual ($30k basis) the engine would wrongly treat the whole $30k as
    // tax-free, under-taxing and under-penalizing.
    const transfers: Transfer[] = [
      {
        id: "t1", name: "Roth to checking #1", sourceAccountId: "roth-1",
        targetAccountId: "checking-1", amount: 50000, mode: "one_time",
        startYear: 2028, growthRate: 0, schedules: [],
      },
      {
        id: "t2", name: "Roth to checking #2", sourceAccountId: "roth-1",
        targetAccountId: "checking-1", amount: 30000, mode: "one_time",
        startYear: 2028, growthRate: 0, schedules: [],
      },
    ];
    const balances: Record<string, number> = { "roth-1": 100000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "roth-1": 60000, "checking-1": 0 };
    const ledgers: Record<string, AccountLedger> = {
      "roth-1": makeLedger(100000),
      "checking-1": makeLedger(50000),
    };

    const result = applyTransfers({
      transfers, accounts: [rothAccount, checkingAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 50 },
    });

    expect(basisMap["roth-1"]).toBe(0); // 10k remaining basis fully consumed by the $30k draw
    expect(result.taxableOrdinaryIncome).toBe(20000); // $30k − $10k remaining basis
    expect(result.earlyWithdrawalPenalty).toBe(2000); // 10% of $20k
  });

  it("taxes earnings + penalizes when Roth → cash exceeds source basis (F2)", () => {
    // Roth basis = $60k, value = $100k, withdraw $80k pre-59.5.
    // Expected: $60k from basis (tax-free), $20k earnings → OI + 10% penalty.
    const transfers: Transfer[] = [{
      id: "t1", name: "Roth to checking", sourceAccountId: "roth-1",
      targetAccountId: "checking-1", amount: 80000, mode: "one_time",
      startYear: 2028, growthRate: 0, schedules: [],
    }];
    const balances: Record<string, number> = { "roth-1": 100000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "roth-1": 60000, "checking-1": 0 };
    const ledgers: Record<string, AccountLedger> = {
      "roth-1": makeLedger(100000),
      "checking-1": makeLedger(50000),
    };

    const result = applyTransfers({
      transfers, accounts: [rothAccount, checkingAccount], accountBalances: balances,
      basisMap, accountLedgers: ledgers, year: 2028, ownerAges: { client: 50 },
    });

    expect(result.taxableOrdinaryIncome).toBe(20000);
    expect(result.earlyWithdrawalPenalty).toBe(2000); // 10% of $20k
  });
});
