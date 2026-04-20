import { describe, it, expect } from "vitest";
import { executeWithdrawals } from "../withdrawal";
import { computeWithdrawalPenalty } from "../withdrawal";
import { sampleWithdrawalStrategy } from "./fixtures";

describe("executeWithdrawals", () => {
  const balances: Record<string, number> = {
    "acct-savings": 50000,
    "acct-brokerage": 300000,
    "acct-401k": 500000,
    "acct-roth": 200000,
  };

  it("pulls from accounts in priority order", () => {
    const result = executeWithdrawals(30000, sampleWithdrawalStrategy, balances, 2026);
    expect(result.byAccount["acct-savings"]).toBe(30000);
    expect(result.total).toBe(30000);
    expect(result.byAccount["acct-brokerage"]).toBeUndefined();
  });

  it("spills over to next account when first is exhausted", () => {
    const result = executeWithdrawals(70000, sampleWithdrawalStrategy, balances, 2026);
    expect(result.byAccount["acct-savings"]).toBe(50000);
    expect(result.byAccount["acct-brokerage"]).toBe(20000);
    expect(result.total).toBe(70000);
  });

  it("returns zero withdrawals when deficit is zero", () => {
    const result = executeWithdrawals(0, sampleWithdrawalStrategy, balances, 2026);
    expect(result.total).toBe(0);
  });

  it("caps at total available across all accounts", () => {
    const result = executeWithdrawals(2000000, sampleWithdrawalStrategy, balances, 2026);
    expect(result.total).toBe(1050000);
  });

  it("skips accounts outside their year range", () => {
    const strategy = [
      { accountId: "acct-savings", priorityOrder: 1, startYear: 2030, endYear: 2055 },
      { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
    ];
    const result = executeWithdrawals(30000, strategy, balances, 2026);
    expect(result.byAccount["acct-savings"]).toBeUndefined();
    expect(result.byAccount["acct-brokerage"]).toBe(30000);
  });
});

describe("computeWithdrawalPenalty", () => {
  it("returns 10% penalty for traditional IRA withdrawal before 59.5", () => {
    const penalty = computeWithdrawalPenalty({
      amount: 50000, accountCategory: "retirement", accountSubType: "traditional_ira",
      ownerAge: 55, rothBasis: 0,
    });
    expect(penalty).toBe(5000);
  });

  it("returns 0 penalty for traditional IRA withdrawal at 60", () => {
    const penalty = computeWithdrawalPenalty({
      amount: 50000, accountCategory: "retirement", accountSubType: "traditional_ira",
      ownerAge: 60, rothBasis: 0,
    });
    expect(penalty).toBe(0);
  });

  it("returns 0 penalty for non-retirement withdrawal", () => {
    const penalty = computeWithdrawalPenalty({
      amount: 50000, accountCategory: "taxable", accountSubType: "brokerage",
      ownerAge: 30, rothBasis: 0,
    });
    expect(penalty).toBe(0);
  });

  it("penalizes only Roth earnings above basis before 59.5", () => {
    const penalty = computeWithdrawalPenalty({
      amount: 50000, accountCategory: "retirement", accountSubType: "roth_ira",
      ownerAge: 50, rothBasis: 30000,
    });
    expect(penalty).toBe(2000); // 10% of (50k - 30k basis) = 10% of 20k
  });

  it("no penalty for Roth withdrawal within basis", () => {
    const penalty = computeWithdrawalPenalty({
      amount: 20000, accountCategory: "retirement", accountSubType: "roth_ira",
      ownerAge: 50, rothBasis: 30000,
    });
    expect(penalty).toBe(0);
  });
});
