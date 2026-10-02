import { describe, it, expect } from "vitest";
import { computeExpenses } from "../expenses";
import { scaleFactorFor } from "../retirement-proration";
import type { Expense } from "../types";
import { sampleExpenses, baseClient } from "./fixtures";

describe("computeExpenses", () => {
  it("sums active expenses by type for the year", () => {
    const result = computeExpenses(sampleExpenses, 2026, baseClient);
    expect(result.living).toBe(80000);
    expect(result.insurance).toBe(5000);
    expect(result.total).toBe(85000);
  });

  it("applies growth rate in subsequent years", () => {
    const result = computeExpenses(sampleExpenses, 2027, baseClient);
    expect(result.living).toBeCloseTo(80000 * 1.03, 0);
    expect(result.insurance).toBeCloseTo(5000 * 1.02, 0);
  });

  it("excludes expenses outside their year range", () => {
    const result = computeExpenses(sampleExpenses, 2046, baseClient);
    expect(result.insurance).toBe(0);
    expect(result.living).toBeGreaterThan(0);
  });

  it("returns all zeros when no expenses active", () => {
    const result = computeExpenses([], 2026, baseClient);
    expect(result.total).toBe(0);
  });
});

describe("scale windows (LTC living-expense cut)", () => {
  const living: Expense = {
    id: "exp-living",
    type: "living",
    name: "Living",
    annualAmount: 100_000,
    startYear: 2026,
    endYear: 2060,
    growthRate: 0,
    scaleWindows: [{ startYear: 2030, endYear: 2031, factor: 0.4 }],
  };

  it("scales the amount inside the window only", () => {
    expect(computeExpenses([living], 2029, baseClient).living).toBe(100_000);
    expect(computeExpenses([living], 2030, baseClient).living).toBeCloseTo(40_000, 6);
    expect(computeExpenses([living], 2031, baseClient).bySource["exp-living"]).toBeCloseTo(40_000, 6);
    expect(computeExpenses([living], 2032, baseClient).living).toBe(100_000);
  });

  it("a factor of 0 drops the row like a suspension (absent from bySource)", () => {
    const cut = { ...living, scaleWindows: [{ startYear: 2030, endYear: 2030, factor: 0 }] };
    const out = computeExpenses([cut], 2030, baseClient);
    expect(out.living).toBe(0);
    expect(out.bySource["exp-living"]).toBeUndefined();
  });

  it("scaleFactorFor multiplies windows that contain the year", () => {
    expect(scaleFactorFor(null, 2030)).toBe(1);
    expect(scaleFactorFor([{ startYear: 2030, endYear: 2030, factor: 0.5 }], 2031)).toBe(1);
  });
});
