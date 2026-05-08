import { describe, it, expect } from "vitest";
import { computeBusinessEntityNetIncome } from "../entity-flows";
import type { Income, Expense } from "../types";

const baseIncome = (overrides: Partial<Income> = {}): Income => ({
  id: "i1",
  type: "business",
  name: "Income",
  annualAmount: 0,
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  owner: "client",
  scheduleOverrides: undefined,
  ...overrides,
});

const baseExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "e1",
  type: "other",
  name: "Expense",
  annualAmount: 0,
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  scheduleOverrides: undefined,
  ...overrides,
});

describe("computeBusinessEntityNetIncome", () => {
  it("returns 0 when entity has no incomes or expenses", () => {
    const result = computeBusinessEntityNetIncome("e1", [], [], 2026);
    expect(result).toBe(0);
  });

  it("sums entity-owned incomes and subtracts entity-owned expenses", () => {
    const incomes = [
      baseIncome({ id: "i1", ownerEntityId: "e1", annualAmount: 100_000 }),
    ];
    const expenses = [
      baseExpense({ id: "x1", ownerEntityId: "e1", annualAmount: 30_000 }),
    ];
    const result = computeBusinessEntityNetIncome("e1", incomes, expenses, 2026);
    expect(result).toBe(70_000);
  });

  it("ignores incomes/expenses owned by a different entity", () => {
    const incomes = [
      baseIncome({ id: "i1", ownerEntityId: "e1", annualAmount: 100_000 }),
      baseIncome({ id: "i2", ownerEntityId: "e2", annualAmount: 50_000 }),
    ];
    const expenses = [
      baseExpense({ id: "x1", ownerEntityId: "e2", annualAmount: 30_000 }),
    ];
    const result = computeBusinessEntityNetIncome("e1", incomes, expenses, 2026);
    expect(result).toBe(100_000);
  });

  it("returns 0 outside the income's start/end year window", () => {
    const incomes = [
      baseIncome({ ownerEntityId: "e1", annualAmount: 100_000, startYear: 2030, endYear: 2035 }),
    ];
    const result = computeBusinessEntityNetIncome("e1", incomes, [], 2026);
    expect(result).toBe(0);
  });

  it("applies growth rate compounding from inflationStartYear or startYear", () => {
    const incomes = [
      baseIncome({
        ownerEntityId: "e1",
        annualAmount: 100_000,
        startYear: 2026,
        growthRate: 0.03,
      }),
    ];
    const result = computeBusinessEntityNetIncome("e1", incomes, [], 2028);
    expect(result).toBeCloseTo(100_000 * Math.pow(1.03, 2), 2);
  });

  it("respects per-row scheduleOverrides when present", () => {
    const incomes = [
      baseIncome({
        ownerEntityId: "e1",
        annualAmount: 100_000,
        scheduleOverrides: { 2026: 250_000, 2027: 0 },
      }),
    ];
    expect(computeBusinessEntityNetIncome("e1", incomes, [], 2026)).toBe(250_000);
    expect(computeBusinessEntityNetIncome("e1", incomes, [], 2027)).toBe(0);
  });

  it("returns negative net income when expenses exceed incomes", () => {
    const incomes = [baseIncome({ ownerEntityId: "e1", annualAmount: 50_000 })];
    const expenses = [baseExpense({ ownerEntityId: "e1", annualAmount: 80_000 })];
    expect(computeBusinessEntityNetIncome("e1", incomes, expenses, 2026)).toBe(-30_000);
  });
});
