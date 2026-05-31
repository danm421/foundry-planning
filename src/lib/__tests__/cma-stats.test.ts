import { describe, it, expect } from "vitest";
import {
  monthlyReturns,
  annualizedArithmetic,
  annualizedGeometric,
  annualizedVolatility,
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
