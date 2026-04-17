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
