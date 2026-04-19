import { describe, it, expect } from "vitest";
import { computeExpenses } from "../expenses";
import { applySavingsRules } from "../savings";
import type { Expense, SavingsRule } from "../types";

describe("expense schedule overrides", () => {
  const expense: Expense = {
    id: "exp-scheduled",
    type: "other",
    name: "College Tuition",
    annualAmount: 60000,
    startYear: 2030,
    endYear: 2035,
    growthRate: 0.03,
    scheduleOverrides: new Map([
      [2030, 55000],
      [2031, 57000],
      [2032, 59000],
      [2033, 61000],
    ]),
  };

  it("uses override amount for years with overrides", () => {
    const result = computeExpenses([expense], 2031);
    expect(result.other).toBe(57000);
  });

  it("uses $0 for years within range but without override", () => {
    const result = computeExpenses([expense], 2034);
    expect(result.other).toBe(0);
  });

  it("uses growth-rate logic when no overrides exist", () => {
    const noOverride: Expense = { ...expense, scheduleOverrides: undefined };
    const result = computeExpenses([noOverride], 2031);
    expect(result.other).toBeCloseTo(61800, 0);
  });
});

describe("savings rule schedule overrides", () => {
  const rule: SavingsRule = {
    id: "sav-scheduled",
    accountId: "acct-401k",
    annualAmount: 23500,
    isDeductible: true,
    startYear: 2026,
    endYear: 2035,
    employerMatchPct: 0.5,
    employerMatchCap: 0.06,
    scheduleOverrides: new Map([
      [2026, 23500],
      [2027, 23500],
      [2028, 10000],
    ]),
  };

  it("uses override amount instead of annualAmount", () => {
    const result = applySavingsRules([rule], 2028, 150000);
    expect(result.byAccount["acct-401k"]).toBe(10000);
  });

  it("uses $0 for years without override", () => {
    const result = applySavingsRules([rule], 2030, 150000);
    expect(result.byAccount["acct-401k"]).toBeUndefined();
    expect(result.total).toBe(0);
  });

  it("still applies employer match on override amount", () => {
    const result = applySavingsRules([rule], 2026, 150000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
    expect(result.employerTotal).toBe(4500);
  });

});
