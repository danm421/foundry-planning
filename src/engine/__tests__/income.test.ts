import { describe, it, expect } from "vitest";
import { computeIncome } from "../income";
import { sampleIncomes, baseClient } from "./fixtures";

describe("computeIncome", () => {
  it("sums active salary income for the year", () => {
    const result = computeIncome(sampleIncomes, 2026, baseClient);
    // John: 150000, Jane: 100000
    expect(result.salaries).toBe(250000);
    expect(result.total).toBe(250000);
  });

  it("applies growth rate in subsequent years", () => {
    const result = computeIncome(sampleIncomes, 2027, baseClient);
    // John: 150000 * 1.03 = 154500, Jane: 100000 * 1.03 = 103000
    expect(result.salaries).toBeCloseTo(257500, 0);
  });

  it("excludes income outside its start/end year range", () => {
    const result = computeIncome(sampleIncomes, 2036, baseClient);
    // John salary ends 2035, Jane salary still active
    // Jane: 100000 * 1.03^10 = 134391.64
    expect(result.salaries).toBeCloseTo(134391.64, 0);
  });

  it("delays social security until claiming age", () => {
    // John born 1970, claiming age 67 → starts 2037
    const before = computeIncome(sampleIncomes, 2036, baseClient);
    expect(before.socialSecurity).toBe(0);

    const after = computeIncome(sampleIncomes, 2037, baseClient);
    // SS: 36000 * 1.02^11 (11 years of COLA from 2026)
    expect(after.socialSecurity).toBeCloseTo(36000 * Math.pow(1.02, 11), 0);
  });

  it("returns all zeros when no income is active", () => {
    const result = computeIncome([], 2026, baseClient);
    expect(result.total).toBe(0);
    expect(result.salaries).toBe(0);
    expect(result.socialSecurity).toBe(0);
  });
});
