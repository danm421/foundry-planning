import { describe, it, expect } from "vitest";
import { buildLockInCutMutations } from "../lock-in-cut";
import type { Expense } from "@/engine/types";

// planStartYear = 2025, so a row with startYear === 2025 is a WORKING row
// (isRetirementLivingExpense returns false: 2025 > 2025 is false, and no
// startYearRef set). startYear > planStartYear would flip it to retirement.
const working = (over: Partial<Expense>): Expense => ({
  id: "x", name: "Living", type: "living", annualAmount: 100_000,
  startYear: 2025, endYear: 2060, growthRate: 0, growthSource: "inflation",
  ...over,
} as Expense);

describe("buildLockInCutMutations", () => {
  it("reduces a single working living row by the cut amount", () => {
    const muts = buildLockInCutMutations([working({ id: "L1", annualAmount: 100_000 })], 2025, 2026, 12_000);
    expect(muts).toEqual([
      { kind: "expense-annual-amount", expenseId: "L1", annualAmount: 88_000 },
    ]);
  });

  it("distributes the cut across multiple working living rows proportionally", () => {
    const muts = buildLockInCutMutations(
      [working({ id: "A", annualAmount: 60_000 }), working({ id: "B", annualAmount: 40_000 })],
      2025, 2026, 10_000,
    );
    expect(muts).toEqual([
      { kind: "expense-annual-amount", expenseId: "A", annualAmount: 54_000 },
      { kind: "expense-annual-amount", expenseId: "B", annualAmount: 36_000 },
    ]);
  });

  it("floors a row at 0 and never produces a negative amount", () => {
    const muts = buildLockInCutMutations([working({ id: "L1", annualAmount: 5_000 })], 2025, 2026, 9_000);
    expect(muts).toEqual([{ kind: "expense-annual-amount", expenseId: "L1", annualAmount: 0 }]);
  });

  it("ignores rows not active in the current year and non-living rows", () => {
    const muts = buildLockInCutMutations(
      [
        // future row: startYear > currentYear (2026), excluded by date filter
        working({ id: "future", startYear: 2040, annualAmount: 50_000 }),
        // non-living row
        { id: "ins", name: "Ins", type: "insurance", annualAmount: 5_000, startYear: 2025, endYear: 2060, growthRate: 0, growthSource: "inflation" } as Expense,
        working({ id: "now", annualAmount: 80_000 }),
      ],
      2025, 2026, 8_000,
    );
    expect(muts).toEqual([{ kind: "expense-annual-amount", expenseId: "now", annualAmount: 72_000 }]);
  });

  it("returns [] when the cut is 0 or there are no working living rows", () => {
    expect(buildLockInCutMutations([working({ id: "L1" })], 2025, 2026, 0)).toEqual([]);
    expect(buildLockInCutMutations([], 2025, 2026, 5_000)).toEqual([]);
  });
});
