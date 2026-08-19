import { describe, it, expect } from "vitest";
import { deferralAccounts } from "../deferral-rules";
import type { ClientData, Income, SavingsRule } from "@/engine/types";

function rule(over: Partial<SavingsRule> & { accountId: string }): SavingsRule {
  return {
    id: over.accountId + "-r",
    annualAmount: 0,
    isDeductible: true,
    startYear: 2020,
    endYear: 2060,
    ...over,
  };
}

function salary(annualAmount: number): Income {
  return {
    id: "i1",
    type: "salary",
    name: "Salary",
    annualAmount,
    startYear: 2020,
    endYear: 2060,
    growthRate: 0.03,
    owner: "client",
  } as Income;
}

function tree(rules: SavingsRule[], incomes: Income[]): ClientData {
  return { savingsRules: rules, incomes } as unknown as ClientData;
}

describe("deferralAccounts", () => {
  it("picks up a rule already in percent-of-salary mode", () => {
    const t = tree([rule({ accountId: "a1", annualPercent: 0.08 })], [salary(120_000)]);
    expect(deferralAccounts(t, 2026)).toEqual([
      { accountId: "a1", currentPercent: 0.08, ruleCount: 1 },
    ]);
  });

  it("converts a flat-dollar rule to its implied percent of salary", () => {
    const t = tree([rule({ accountId: "a1", annualAmount: 12_000 })], [salary(120_000)]);
    expect(deferralAccounts(t, 2026)).toEqual([
      { accountId: "a1", currentPercent: 0.1, ruleCount: 1 },
    ]);
  });

  it("ignores a flat-dollar rule when the household has no salary to divide by", () => {
    const t = tree([rule({ accountId: "a1", annualAmount: 12_000 })], [salary(0)]);
    expect(deferralAccounts(t, 2026)).toEqual([]);
  });

  it("returns every deferral account, not just the first", () => {
    const t = tree(
      [rule({ accountId: "a1", annualPercent: 0.06 }), rule({ accountId: "a2", annualPercent: 0.04 })],
      [salary(120_000)],
    );
    expect(deferralAccounts(t, 2026).map((d) => d.accountId)).toEqual(["a1", "a2"]);
  });

  it("skips a rule whose own window has not opened yet", () => {
    const t = tree(
      [rule({ accountId: "a1", annualPercent: 0.06, startYear: 2032, endYear: 2060 })],
      [salary(120_000)],
    );
    expect(deferralAccounts(t, 2026)).toEqual([]);
  });

  it("sums two rules on one account into a single entry and reports the rule count", () => {
    const t = tree(
      [
        rule({ id: "r1", accountId: "a1", annualPercent: 0.06 }),
        rule({ id: "r2", accountId: "a1", annualPercent: 0.02 }),
      ],
      [salary(120_000)],
    );
    expect(deferralAccounts(t, 2026)).toEqual([
      { accountId: "a1", currentPercent: 0.08, ruleCount: 2 },
    ]);
  });

  it("counts only salary income, not business or trust income", () => {
    const t = tree(
      [rule({ accountId: "a1", annualAmount: 12_000 })],
      [salary(60_000), { ...salary(60_000), id: "i2", type: "business" } as Income],
    );
    expect(deferralAccounts(t, 2026)[0].currentPercent).toBeCloseTo(0.2, 6);
  });
});
