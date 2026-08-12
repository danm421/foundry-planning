import { describe, it, expect } from "vitest";
import { buildOutcomeCone } from "../outcomes";

describe("buildOutcomeCone", () => {
  const input = {
    startValue: 1_000_000,
    current: { arithmeticMean: 0.06, stdDev: 0.12 },
    proposed: { arithmeticMean: 0.07, stdDev: 0.11 },
    years: [10, 20],
  };

  it("returns one row per horizon for each side", () => {
    const cone = buildOutcomeCone(input);
    expect(cone.current.map((r) => r.years)).toEqual([10, 20]);
    expect(cone.proposed.map((r) => r.years)).toEqual([10, 20]);
  });

  it("orders the percentiles", () => {
    for (const row of buildOutcomeCone(input).current) {
      expect(row.p10).toBeLessThan(row.p50);
      expect(row.p50).toBeLessThan(row.p90);
    }
  });

  it("puts the median at the geometric drift", () => {
    // median = V0 * exp((mu - sigma^2/2) * t)
    const cone = buildOutcomeCone(input);
    const expected = 1_000_000 * Math.exp((0.06 - 0.12 ** 2 / 2) * 10);
    expect(cone.current[0].p50).toBeCloseTo(expected, 2);
  });

  it("widens the band with the horizon", () => {
    const cone = buildOutcomeCone(input);
    const spread = (i: number) => cone.current[i].p90 / cone.current[i].p10;
    expect(spread(1)).toBeGreaterThan(spread(0));
  });

  it("collapses to a point when volatility is zero", () => {
    const cone = buildOutcomeCone({
      ...input,
      current: { arithmeticMean: 0.05, stdDev: 0 },
    });
    const row = cone.current[0];
    expect(row.p10).toBeCloseTo(row.p50, 6);
    expect(row.p90).toBeCloseTo(row.p50, 6);
  });
});
