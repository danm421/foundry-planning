import { describe, it, expect } from "vitest";
import type { ClientData, Expense } from "@/engine/types";
import {
  isRetirementLivingExpense,
  roundToNearest2k,
  retirementLivingExpenseTotal,
  synthesizeRetirementLivingExpense,
} from "../living-expense";

function expense(over: Partial<Expense>): Expense {
  return {
    id: "e",
    type: "living",
    name: "Living",
    annualAmount: 0,
    startYear: 2040,
    endYear: 2070,
    growthRate: 0.025,
    ...over,
  } as Expense;
}

describe("isRetirementLivingExpense", () => {
  it("is true only for living expenses that begin after plan start", () => {
    expect(isRetirementLivingExpense(expense({ startYear: 2040 }), 2026)).toBe(true);
    // current (working-year) living expense, anchored to plan start
    expect(isRetirementLivingExpense(expense({ startYear: 2026 }), 2026)).toBe(false);
    // non-living rows never count
    expect(
      isRetirementLivingExpense(expense({ type: "insurance", startYear: 2040 }), 2026),
    ).toBe(false);
  });
});

describe("roundToNearest2k", () => {
  it("rounds to the nearest $2,000", () => {
    expect(roundToNearest2k(118_900)).toBe(118_000);
    expect(roundToNearest2k(119_001)).toBe(120_000);
    expect(roundToNearest2k(113_700)).toBe(114_000);
    expect(roundToNearest2k(0)).toBe(0);
  });
});

describe("retirementLivingExpenseTotal", () => {
  it("sums only living expenses that start after plan start", () => {
    const tree = {
      planSettings: { planStartYear: 2026 },
      expenses: [
        expense({ id: "current", annualAmount: 80_000, startYear: 2026 }), // working-year
        expense({ id: "ret1", annualAmount: 90_000, startYear: 2040 }), // retirement
        expense({ id: "ret2", annualAmount: 10_000, startYear: 2045 }), // retirement
        expense({ id: "ins", type: "insurance", annualAmount: 5_000, startYear: 2041 }),
      ],
    } as unknown as ClientData;
    expect(retirementLivingExpenseTotal(tree)).toBe(100_000);
  });

  it("is 0 when there are no retirement living expenses", () => {
    const tree = {
      planSettings: { planStartYear: 2026 },
      expenses: [expense({ annualAmount: 80_000, startYear: 2026 })],
    } as unknown as ClientData;
    expect(retirementLivingExpenseTotal(tree)).toBe(0);
  });
});

describe("synthesizeRetirementLivingExpense", () => {
  it("builds a retirement-anchored living expense at the given amount", () => {
    const tree = {
      planSettings: { planStartYear: 2026, planEndYear: 2070, inflationRate: 0.025 },
      client: { retirementAge: 65 },
      expenses: [],
    } as unknown as ClientData;

    const e = synthesizeRetirementLivingExpense(tree, 80_000);
    expect(e.type).toBe("living");
    expect(e.annualAmount).toBe(80_000);
    expect(e.startYearRef).toBe("client_retirement");
    expect(e.endYearRef).toBe("plan_end");
    expect(e.growthRate).toBe(0.025);
    expect(typeof e.id).toBe("string");
    expect(e.id.length).toBeGreaterThan(0);
  });
});
