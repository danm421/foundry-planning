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

describe("flowMode = 'schedule' (custom-schedule mode)", () => {
  it("ignores base+growth and returns 0 when no override exists", () => {
    const inc = baseIncome({ ownerEntityId: "e1", annualAmount: 100_000, growthRate: 0.05 });
    expect(
      resolveEntityFlowAmount(inc, "e1", "income", 2027, [], "schedule"),
    ).toBe(0);
  });

  it("returns the override when one exists for that year", () => {
    const inc = baseIncome({ ownerEntityId: "e1", annualAmount: 100_000 });
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2027, incomeAmount: 250_000, expenseAmount: null, distributionPercent: null },
    ];
    expect(
      resolveEntityFlowAmount(inc, "e1", "income", 2027, overrides, "schedule"),
    ).toBe(250_000);
  });

  it("net income returns 0 when in schedule mode and no overrides exist", () => {
    const incomes = [baseIncome({ ownerEntityId: "e1", annualAmount: 100_000 })];
    const expenses = [baseExpense({ ownerEntityId: "e1", annualAmount: 30_000 })];
    expect(
      computeBusinessEntityNetIncome("e1", incomes, expenses, 2026, [], "schedule"),
    ).toBe(0);
  });

  it("distribution percent returns 0 when in schedule mode without override", () => {
    const entity: EntitySummary = {
      id: "e1",
      isGrantor: false,
      includeInPortfolio: false,
      entityType: "llc",
      distributionPolicyPercent: 0.5,
      flowMode: "schedule",
    };
    expect(resolveDistributionPercent(entity, 2027, [])).toBe(0);
  });

  it("distribution percent returns the override in schedule mode", () => {
    const entity: EntitySummary = {
      id: "e1",
      isGrantor: false,
      includeInPortfolio: false,
      entityType: "llc",
      distributionPolicyPercent: 0.5,
      flowMode: "schedule",
    };
    const overrides: EntityFlowOverride[] = [
      { entityId: "e1", year: 2027, incomeAmount: null, expenseAmount: null, distributionPercent: 0.25 },
    ];
    expect(resolveDistributionPercent(entity, 2027, overrides)).toBe(0.25);
  });
});

describe("F12 — policy-sourced rows keep their own schedule", () => {
  const policyRow = {
    annualAmount: 0,
    growthRate: 0,
    startYear: 2026,
    endYear: 2030,
    source: "policy" as const,
    scheduleOverrides: { 2026: 87_216, 2027: 87_216 },
  };

  it("uses the per-row schedule when no entity grid cell exists", () => {
    const amount = resolveEntityFlowAmount(
      policyRow, "ent-1", "expense", 2026, [], "annual",
    );
    expect(amount).toBe(87_216);
  });

  it("uses the per-row schedule for the income direction too (policy-income.ts builds the same shape)", () => {
    // resolveEntityFlowAmount is shared by income and expense callers — the
    // policySchedule branch doesn't discriminate on `field`, so an
    // entity-owned policy INCOME row (synthesizePolicyIncome) must resolve
    // its schedule exactly like an expense row does.
    const amount = resolveEntityFlowAmount(
      policyRow, "ent-1", "income", 2026, [], "annual",
    );
    expect(amount).toBe(87_216);
  });

  it("returns 0 for a year inside the row's window but missing from the schedule map (falls through to ?? 0)", () => {
    const amount = resolveEntityFlowAmount(
      policyRow, "ent-1", "expense", 2029, [], "annual",
    );
    expect(amount).toBe(0);
  });

  it("lets an entity grid cell win over the per-row schedule", () => {
    const amount = resolveEntityFlowAmount(
      policyRow, "ent-1", "expense", 2026,
      [{ entityId: "ent-1", year: 2026, expenseAmount: 50_000 }],
      "annual",
    );
    expect(amount).toBe(50_000);
  });

  it("applies the policy schedule in schedule flowMode too", () => {
    const amount = resolveEntityFlowAmount(
      policyRow, "ent-1", "expense", 2027, [], "schedule",
    );
    expect(amount).toBe(87_216);
  });

  it("does NOT consult scheduleOverrides on a non-policy row (P2-3 stands)", () => {
    const userRow = {
      annualAmount: 10_000,
      growthRate: 0,
      startYear: 2026,
      endYear: 2030,
      scheduleOverrides: { 2026: 99_999 },
    };
    const amount = resolveEntityFlowAmount(
      userRow, "ent-1", "expense", 2026, [], "annual",
    );
    expect(amount).toBe(10_000);
  });

  it("does not pay a premium before the policy's startYear, even when the schedule map carries an earlier key (audit finding on F12)", () => {
    // resolvePremiumSchedule (src/lib/insurance-policies/premium-expense.ts) builds
    // scheduleOverrides from every cashValueSchedule row, then clamps the row's
    // startYear UP to currentYear/activationYear — but the overrides map keeps
    // the earlier keys. A late-activating policy's row therefore has schedule
    // entries below its own startYear; the resolver must not resurrect them.
    const lateActivationRow = {
      annualAmount: 0,
      growthRate: 0,
      startYear: 2030,
      endYear: 2032,
      source: "policy" as const,
      scheduleOverrides: { 2026: 40_000, 2030: 40_000 },
    };
    const beforeActivation = resolveEntityFlowAmount(
      lateActivationRow, "ent-1", "expense", 2026, [], "annual",
    );
    expect(beforeActivation).toBe(0);

    const atActivation = resolveEntityFlowAmount(
      lateActivationRow, "ent-1", "expense", 2030, [], "annual",
    );
    expect(atActivation).toBe(40_000);
  });
});
