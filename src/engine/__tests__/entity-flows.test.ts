import { describe, it, expect } from "vitest";
import {
  computeBusinessEntityNetIncome,
  resolveEntityFlowAmount,
  resolveDistributionPercent,
} from "../entity-flows";
import type { Income, Expense } from "../types";
import type { EntityFlowOverride, EntitySummary } from "../types";

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
    const result = computeBusinessEntityNetIncome("e1", [], [], 2026, []);
    expect(result).toBe(0);
  });

  it("sums entity-owned incomes and subtracts entity-owned expenses", () => {
    const incomes = [
      baseIncome({ id: "i1", ownerEntityId: "e1", annualAmount: 100_000 }),
    ];
    const expenses = [
      baseExpense({ id: "x1", ownerEntityId: "e1", annualAmount: 30_000 }),
    ];
    const result = computeBusinessEntityNetIncome("e1", incomes, expenses, 2026, []);
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
    const result = computeBusinessEntityNetIncome("e1", incomes, expenses, 2026, []);
    expect(result).toBe(100_000);
  });

  it("returns 0 outside the income's start/end year window", () => {
    const incomes = [
      baseIncome({ ownerEntityId: "e1", annualAmount: 100_000, startYear: 2030, endYear: 2035 }),
    ];
    const result = computeBusinessEntityNetIncome("e1", incomes, [], 2026, []);
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
    const result = computeBusinessEntityNetIncome("e1", incomes, [], 2028, []);
    expect(result).toBeCloseTo(100_000 * Math.pow(1.03, 2), 2);
  });

  it("ignores per-row scheduleOverrides (replaced by Phase 2 entity_flow_overrides)", () => {
    const incomes = [
      baseIncome({
        ownerEntityId: "e1",
        annualAmount: 100_000,
        scheduleOverrides: { 2026: 250_000, 2027: 0 },
      }),
    ];
    // scheduleOverrides on entity-owned rows are ignored (P2-3); base amount is used instead
    expect(computeBusinessEntityNetIncome("e1", incomes, [], 2026, [])).toBe(100_000);
    expect(computeBusinessEntityNetIncome("e1", incomes, [], 2027, [])).toBe(100_000);
  });

  it("returns negative net income when expenses exceed incomes", () => {
    const incomes = [baseIncome({ ownerEntityId: "e1", annualAmount: 50_000 })];
    const expenses = [baseExpense({ ownerEntityId: "e1", annualAmount: 80_000 })];
    expect(computeBusinessEntityNetIncome("e1", incomes, expenses, 2026, [])).toBe(-30_000);
  });
});

describe("resolveEntityFlowAmount", () => {
  const baseRow = {
    annualAmount: 100_000,
    growthRate: 0.03,
    startYear: 2026,
    inflationStartYear: 2026,
    endYear: 2050,
  };

  it("returns base+growth when no override exists for the year", () => {
    expect(resolveEntityFlowAmount(baseRow, "e1", "income", 2028, [])).toBeCloseTo(
      100_000 * Math.pow(1.03, 2),
      2,
    );
  });

  it("returns 0 outside the row's start/end window", () => {
    expect(
      resolveEntityFlowAmount({ ...baseRow, startYear: 2030 }, "e1", "income", 2026, []),
    ).toBe(0);
  });

  it("returns the override value when one exists for the year", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2028, incomeAmount: 250_000 },
    ];
    expect(resolveEntityFlowAmount(baseRow, "e1", "income", 2028, overrides)).toBe(250_000);
  });

  it("returns the override even when the year is outside the row's window", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2025, incomeAmount: 50_000 },
    ];
    expect(resolveEntityFlowAmount(baseRow, "e1", "income", 2025, overrides)).toBe(50_000);
  });

  it("ignores overrides for a different entity", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e2", year: 2028, incomeAmount: 999_999 },
    ];
    expect(resolveEntityFlowAmount(baseRow, "e1", "income", 2028, overrides)).toBeCloseTo(
      100_000 * Math.pow(1.03, 2),
      2,
    );
  });

  it("respects null vs zero — null falls through, zero is an explicit override", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2028, incomeAmount: null, expenseAmount: 5_000 },
    ];
    // incomeAmount is null → fall through to base+growth
    expect(resolveEntityFlowAmount(baseRow, "e1", "income", 2028, overrides)).toBeCloseTo(
      100_000 * Math.pow(1.03, 2),
      2,
    );
    // expenseAmount is 5_000 → explicit override
    expect(resolveEntityFlowAmount(baseRow, "e1", "expense", 2028, overrides)).toBe(5_000);
  });
});

describe("resolveDistributionPercent", () => {
  const entity: EntitySummary = {
    id: "e1",
    name: "Acme",
    includeInPortfolio: true,
    isGrantor: false,
    entityType: "llc",
    distributionPolicyPercent: 0.5,
    owners: [],
  };

  it("returns the override when one exists for the year", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2028, distributionPercent: 0.75 },
    ];
    expect(resolveDistributionPercent(entity, 2028, overrides)).toBe(0.75);
  });

  it("falls through to the entity base when override is null", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2028, distributionPercent: null },
    ];
    expect(resolveDistributionPercent(entity, 2028, overrides)).toBe(0.5);
  });

  it("falls through to the entity base when no override row exists", () => {
    expect(resolveDistributionPercent(entity, 2028, [])).toBe(0.5);
  });

  it("defaults to 1.0 when entity base is null and no override", () => {
    expect(
      resolveDistributionPercent({ ...entity, distributionPolicyPercent: null }, 2028, []),
    ).toBe(1.0);
  });

  it("override = 0 is honored (explicit no-distribution year)", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2028, distributionPercent: 0 },
    ];
    expect(resolveDistributionPercent(entity, 2028, overrides)).toBe(0);
  });
});

describe("computeBusinessEntityNetIncome — Phase 2 overrides", () => {
  const baseIncomeRow = {
    id: "i1",
    type: "business" as const,
    name: "Income",
    annualAmount: 100_000,
    startYear: 2026,
    endYear: 2050,
    growthRate: 0,
    owner: "client" as const,
    ownerEntityId: "e1",
    inflationStartYear: 2026,
  };
  const baseExpenseRow = {
    id: "x1",
    type: "other" as const,
    name: "Expense",
    annualAmount: 30_000,
    startYear: 2026,
    endYear: 2050,
    growthRate: 0,
    ownerEntityId: "e1",
    inflationStartYear: 2026,
  };

  it("uses override income amount when present", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2028, incomeAmount: 250_000 },
    ];
    expect(
      computeBusinessEntityNetIncome("e1", [baseIncomeRow], [baseExpenseRow], 2028, overrides),
    ).toBe(250_000 - 30_000);
  });

  it("uses override expense amount when present", () => {
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2028, expenseAmount: 80_000 },
    ];
    expect(
      computeBusinessEntityNetIncome("e1", [baseIncomeRow], [baseExpenseRow], 2028, overrides),
    ).toBe(100_000 - 80_000);
  });

  it("ignores per-row scheduleOverrides on entity-owned rows (P2-3)", () => {
    const incomeWithSchedule = {
      ...baseIncomeRow,
      scheduleOverrides: { 2028: 999_999 },
    };
    expect(
      computeBusinessEntityNetIncome("e1", [incomeWithSchedule], [baseExpenseRow], 2028, []),
    ).toBe(100_000 - 30_000);
  });
});
