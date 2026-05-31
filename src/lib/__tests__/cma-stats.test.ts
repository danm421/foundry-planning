import { describe, it, expect } from "vitest";
import {
  monthlyReturns,
  annualizedArithmetic,
  annualizedGeometric,
  annualizedVolatility,
  pairwiseCorrelation,
} from "../cma-stats";

describe("monthlyReturns", () => {
  it("computes simple month-over-month returns, sorted ascending", () => {
    const bars = [
      { date: "2020-03", adjClose: 100 },
      { date: "2020-01", adjClose: 80 },
      { date: "2020-02", adjClose: 88 },
    ];
    expect(monthlyReturns(bars)).toEqual([
      { date: "2020-02", r: expect.closeTo(0.1, 10) }, // 88/80 - 1 (IEEE-754)
      { date: "2020-03", r: expect.closeTo(0.13636, 4) }, // 100/88 - 1
    ]);
  });
});

describe("annualized statistics", () => {
  const r = [0.02, -0.01, 0.03, 0.0];
  it("arithmetic = mean * 12", () => {
    expect(annualizedArithmetic(r)).toBeCloseTo(0.12, 10);
  });
  it("geometric = prod(1+r)^(12/n) - 1", () => {
    expect(annualizedGeometric(r)).toBeCloseTo(0.12517, 4);
  });
  it("volatility = sample stdev (n-1) * sqrt(12)", () => {
    expect(annualizedVolatility(r)).toBeCloseTo(0.063246, 5);
  });
});

describe("pairwiseCorrelation", () => {
  it("returns rho≈1 for perfectly correlated overlapping months", () => {
    const a = [
      { date: "2020-01", r: 0.01 },
      { date: "2020-02", r: 0.02 },
      { date: "2020-03", r: 0.03 },
    ];
    const b = [
      { date: "2020-01", r: 0.02 },
      { date: "2020-02", r: 0.04 },
      { date: "2020-03", r: 0.06 },
    ];
    const { rho, overlapMonths } = pairwiseCorrelation(a, b);
    expect(overlapMonths).toBe(3);
    expect(rho).toBeCloseTo(1, 10);
  });

  it("only uses the overlapping months (ragged windows)", () => {
    const a = [
      { date: "2019-12", r: 0.5 }, // not in b — must be ignored
      { date: "2020-01", r: 0.01 },
      { date: "2020-02", r: -0.02 },
    ];
    const b = [
      { date: "2020-01", r: 0.01 },
      { date: "2020-02", r: -0.02 },
      { date: "2020-03", r: 0.9 }, // not in a — must be ignored
    ];
    const { rho, overlapMonths } = pairwiseCorrelation(a, b);
    expect(overlapMonths).toBe(2);
    expect(rho).toBeCloseTo(1, 10);
  });
});
