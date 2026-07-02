import { describe, it, expect } from "vitest";
import { computeEducationDraw } from "../education/education-funding";

// A trivial categorizer: cash/529 → basisReturn; else ordinaryIncome.
const categorize = (id: string, amount: number) =>
  id === "tax" ? { ordinaryIncome: amount, capitalGains: 0, basisReturn: 0, earlyWithdrawalPenalty: 0 }
               : { ordinaryIncome: 0, capitalGains: 0, basisReturn: amount, earlyWithdrawalPenalty: 0 };

describe("computeEducationDraw", () => {
  it("draws dedicated accounts in order, caps at goal cost", () => {
    const r = computeEducationDraw({
      goalCost: 25000,
      dedicatedAccountIds: ["a1", "a2"],
      balances: { a1: 10000, a2: 40000 },
      categorize,
    });
    expect(r.draws.map((d) => [d.accountId, d.amount])).toEqual([["a1", 10000], ["a2", 15000]]);
    expect(r.dedicatedWithdrawal).toBe(25000);
    expect(r.shortfall).toBe(0);
  });

  it("shortfall when dedicated funds are insufficient", () => {
    const r = computeEducationDraw({
      goalCost: 25000,
      dedicatedAccountIds: ["a1"],
      balances: { a1: 10000 },
      categorize,
    });
    expect(r.dedicatedWithdrawal).toBe(10000);
    expect(r.shortfall).toBe(15000);
  });

  it("aggregates taxable components across draws", () => {
    const r = computeEducationDraw({
      goalCost: 30000,
      dedicatedAccountIds: ["free", "tax"],
      balances: { free: 20000, tax: 20000 },
      categorize,
    });
    expect(r.dedicatedWithdrawal).toBe(30000);
    expect(r.ordinaryIncome).toBe(10000); // 10k drawn from "tax"
    expect(r.shortfall).toBe(0);
  });

  it("no dedicated accounts → full shortfall, no draws", () => {
    const r = computeEducationDraw({ goalCost: 5000, dedicatedAccountIds: [], balances: {}, categorize });
    expect(r.draws).toEqual([]);
    expect(r.dedicatedWithdrawal).toBe(0);
    expect(r.shortfall).toBe(5000);
  });
});
