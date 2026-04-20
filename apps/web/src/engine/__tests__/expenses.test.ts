import { describe, it, expect } from "vitest";
import { computeExpenses } from "../expenses";
import { sampleExpenses } from "./fixtures";

describe("computeExpenses", () => {
  it("sums active expenses by type for the year", () => {
    const result = computeExpenses(sampleExpenses, 2026);
    expect(result.living).toBe(80000);
    expect(result.insurance).toBe(5000);
    expect(result.total).toBe(85000);
  });

  it("applies growth rate in subsequent years", () => {
    const result = computeExpenses(sampleExpenses, 2027);
    expect(result.living).toBeCloseTo(80000 * 1.03, 0);
    expect(result.insurance).toBeCloseTo(5000 * 1.02, 0);
  });

  it("excludes expenses outside their year range", () => {
    const result = computeExpenses(sampleExpenses, 2046);
    expect(result.insurance).toBe(0);
    expect(result.living).toBeGreaterThan(0);
  });

  it("returns all zeros when no expenses active", () => {
    const result = computeExpenses([], 2026);
    expect(result.total).toBe(0);
  });
});
