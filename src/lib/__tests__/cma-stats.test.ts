import { describe, it, expect } from "vitest";
import {
  monthlyReturns,
  annualizedArithmetic,
  annualizedGeometric,
  annualizedVolatility,
  pairwiseCorrelation,
  isPSD,
  repairToPSD,
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

describe("PSD test + repair", () => {
  const psd = [
    [1, 0.5, 0.3],
    [0.5, 1, 0.2],
    [0.3, 0.2, 1],
  ];
  const nonPsd = [
    [1, 0.9, -0.9],
    [0.9, 1, 0.9],
    [-0.9, 0.9, 1],
  ];

  it("isPSD true for a valid correlation matrix", () => {
    expect(isPSD(psd)).toBe(true);
  });
  it("isPSD false for a non-PSD matrix", () => {
    expect(isPSD(nonPsd)).toBe(false);
  });
  it("repairToPSD leaves a PSD matrix unchanged (alpha 0)", () => {
    const { matrix, alpha } = repairToPSD(psd);
    expect(alpha).toBe(0);
    expect(matrix).toEqual(psd);
  });
  it("repairToPSD makes a non-PSD matrix PSD with a small positive alpha, diagonal stays 1", () => {
    const { matrix, alpha } = repairToPSD(nonPsd);
    expect(alpha).toBeGreaterThan(0);
    expect(isPSD(matrix)).toBe(true);
    for (let i = 0; i < matrix.length; i++)
      expect(matrix[i][i]).toBeCloseTo(1, 12);
  });
});
