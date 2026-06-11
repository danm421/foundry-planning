import { describe, it, expect } from "vitest";
import type { MonthlyReturn } from "./cma-stats";
import {
  blendedMonthlyReturns,
  downsideDeviation,
  maxDrawdown,
  portfolioStats,
} from "./portfolio-stats";

const mr = (pairs: [string, number][]): MonthlyReturn[] =>
  pairs.map(([date, r]) => ({ date, r }));

describe("blendedMonthlyReturns", () => {
  it("blends over the months present in ALL series with static weights", () => {
    const a = { weight: 0.5, returns: mr([["2020-01", 0.10], ["2020-02", 0.20], ["2020-03", 0.30]]) };
    const b = { weight: 0.5, returns: mr([["2020-02", 0.00], ["2020-03", 0.10]]) };
    const out = blendedMonthlyReturns([a, b]);
    expect(out.map((x) => x.date)).toEqual(["2020-02", "2020-03"]); // 2020-01 dropped (not in b)
    expect(out[0].r).toBeCloseTo(0.10, 10); // 0.5*0.20 + 0.5*0.00
    expect(out[1].r).toBeCloseTo(0.20, 10); // 0.5*0.30 + 0.5*0.10
  });

  it("returns [] for no series", () => {
    expect(blendedMonthlyReturns([])).toEqual([]);
  });
});

describe("downsideDeviation", () => {
  it("only penalizes returns below the MAR, annualized", () => {
    // returns: -0.02, +0.05 ; MAR = 0 → only -0.02 contributes
    const dd = downsideDeviation([-0.02, 0.05], 0);
    // sqrt( ((-0.02)^2 + 0) / 2 ) * sqrt(12)
    expect(dd).toBeCloseTo(Math.sqrt((0.0004) / 2) * Math.sqrt(12), 10);
  });
});

describe("maxDrawdown", () => {
  it("is the largest peak-to-trough decline on the cumulative path", () => {
    // +10% then -50% then +0% : peak 1.1, trough 0.55 → dd = 0.5
    expect(maxDrawdown([0.10, -0.50, 0.0])).toBeCloseTo(0.5, 10);
  });

  it("is 0 for a monotonically rising path", () => {
    expect(maxDrawdown([0.01, 0.02, 0.03])).toBe(0);
  });
});

describe("portfolioStats", () => {
  it("computes Sharpe/Sortino with an ARITHMETIC excess-return numerator", () => {
    const blended = mr([["2020-01", 0.02], ["2020-02", -0.01], ["2020-03", 0.03]]);
    const s = portfolioStats(blended, 0.04); // 4% annual risk-free
    expect(s.nMonths).toBe(3);
    // Sharpe numerator uses annArithMean (NOT geometric) per Decision 7
    expect(s.sharpe).toBeCloseTo((s.annArithMean - 0.04) / s.annVolatility, 10);
    expect(s.sortino).toBeCloseTo((s.annArithMean - 0.04) / s.downsideDeviation, 10);
  });

  it("guards divide-by-zero (zero volatility → sharpe 0)", () => {
    const flat = mr([["2020-01", 0.01], ["2020-02", 0.01]]);
    expect(portfolioStats(flat, 0.04).sharpe).toBe(0);
  });
});
