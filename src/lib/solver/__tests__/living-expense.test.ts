import { describe, it, expect } from "vitest";
import type { ClientData, Expense } from "@/engine/types";
import {
  isRetirementLivingExpense,
  roundToNearest2k,
  retirementLivingExpenseTotal,
  snapScaleToNearest2k,
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

describe("snapScaleToNearest2k", () => {
  it("adjusts the scale so scale*total lands on the nearest $2,000", () => {
    // 1.137 * 100_000 = 113_700 → rounds to 114_000 → scale 1.14
    expect(snapScaleToNearest2k(1.137, 100_000)).toBeCloseTo(1.14, 10);
    // already on a $2k boundary
    expect(snapScaleToNearest2k(1.2, 100_000)).toBeCloseTo(1.2, 10);
  });

  it("snapped scale * total lands on a $2,000 multiple", () => {
    const total = 87_500;
    const snapped = snapScaleToNearest2k(1.333, total);
    // snapped*total reconstructs the $2k-rounded amount (modulo float drift).
    expect(snapped * total).toBeCloseTo(roundToNearest2k(1.333 * total), 6);
  });

  it("returns the scale unchanged when base total is 0 (no divide-by-zero)", () => {
    expect(snapScaleToNearest2k(1.42, 0)).toBe(1.42);
  });
});
