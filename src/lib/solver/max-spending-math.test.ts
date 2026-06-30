import { describe, it, expect } from "vitest";
import { roundToNearest5k, retirementLivingExpenseTotal } from "./max-spending-math";
import type { ClientData, Expense } from "@/engine/types";

function expense(over: Partial<Expense>): Expense {
  return {
    id: "e", type: "living", name: "x", annualAmount: 0, startYear: 2030,
    endYear: 2060, growthRate: 0.025, ...over,
  } as Expense;
}

describe("roundToNearest5k", () => {
  it("rounds to the nearest $5,000", () => {
    expect(roundToNearest5k(117_400)).toBe(115_000);
    expect(roundToNearest5k(117_600)).toBe(120_000);
    expect(roundToNearest5k(0)).toBe(0);
  });
});

describe("retirementLivingExpenseTotal", () => {
  it("sums only living expenses that start after plan start", () => {
    const tree = {
      planSettings: { planStartYear: 2026 },
      expenses: [
        expense({ id: "current", annualAmount: 80_000, startYear: 2026 }), // working-year
        expense({ id: "ret1", annualAmount: 90_000, startYear: 2040 }),    // retirement
        expense({ id: "ret2", annualAmount: 10_000, startYear: 2045 }),    // retirement
        expense({ id: "ins", type: "insurance", annualAmount: 5_000, startYear: 2041 }), // not living
      ],
    } as unknown as ClientData;
    expect(retirementLivingExpenseTotal(tree)).toBe(100_000);
  });
});
