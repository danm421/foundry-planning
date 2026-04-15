import { describe, it, expect } from "vitest";
import { executeWithdrawals } from "../withdrawal";
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
