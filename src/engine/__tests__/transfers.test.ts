import { describe, it, expect } from "vitest";
import { applyTransfers } from "../transfers";
import type { Account, Transfer, AccountLedger } from "../types";

function makeLedger(value: number): AccountLedger {
  return {
    beginningValue: value, growth: 0, contributions: 0, distributions: 0,
    rmdAmount: 0, fees: 0, endingValue: value, entries: [],
  };
}

const iraAccount: Account = {
  id: "ira-1", name: "Traditional IRA", category: "retirement", subType: "traditional_ira",
  value: 500000, basis: 0, growthRate: 0.07, rmdEnabled: true, owners: [],
};

const rothAccount: Account = {
  id: "roth-1", name: "Roth IRA", category: "retirement", subType: "roth_ira",
  value: 100000, basis: 60000, growthRate: 0.07, rmdEnabled: false, owners: [],
};

const checkingAccount: Account = {
  id: "checking-1", name: "Checking", category: "cash", subType: "checking",
  value: 50000, basis: 50000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true, owners: [],
};

const brokerageAccount: Account = {
  id: "brokerage-1", name: "Brokerage", category: "taxable", subType: "brokerage",
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
});
