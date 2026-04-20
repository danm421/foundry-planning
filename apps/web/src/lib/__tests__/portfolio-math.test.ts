import { describe, it, expect } from "vitest";
import { blendPortfolio, type AssetClassData, type AllocationEntry } from "../portfolio-math";

const sampleClasses: AssetClassData[] = [
  { id: "ac1", geometricReturn: 0.07, arithmeticMean: 0.085, volatility: 0.15, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { id: "ac2", geometricReturn: 0.035, arithmeticMean: 0.0375, volatility: 0.05, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0.10 },
];

describe("blendPortfolio", () => {
  it("computes weighted average of geometric return", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    expect(result.geometricReturn).toBeCloseTo(0.056, 4);
  });

  it("computes weighted average of arithmetic mean", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    expect(result.arithmeticMean).toBeCloseTo(0.066, 4);
  });

  it("computes weighted average of volatility", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    expect(result.volatility).toBeCloseTo(0.11, 4);
  });

  it("computes blended realization percentages", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    expect(result.pctOrdinaryIncome).toBeCloseTo(0.32, 4);
    expect(result.pctLtCapitalGains).toBeCloseTo(0.55, 4);
    expect(result.pctQualifiedDividends).toBeCloseTo(0.09, 4);
    expect(result.pctTaxExempt).toBeCloseTo(0.04, 4);
  });

  it("handles single asset class portfolio", () => {
    const allocs: AllocationEntry[] = [{ assetClassId: "ac1", weight: 1.0 }];
    const result = blendPortfolio(allocs, sampleClasses);
    expect(result.geometricReturn).toBeCloseTo(0.07, 4);
    expect(result.pctLtCapitalGains).toBeCloseTo(0.85, 4);
  });

  it("returns zeros for empty allocations", () => {
    const result = blendPortfolio([], sampleClasses);
    expect(result.geometricReturn).toBe(0);
    expect(result.arithmeticMean).toBe(0);
    expect(result.volatility).toBe(0);
  });

  // Contract lock: the straight-line cash-flow engine uses geometric return,
  // which is always <= arithmetic mean for any volatile asset. Arithmetic mean
  // and volatility are reserved for the future Monte Carlo simulator. This
  // test guards against an accidental swap of which stat drives the projection.
  it("keeps geometric and arithmetic returns as distinct blended outputs", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.5 },
      { assetClassId: "ac2", weight: 0.5 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    // Both samples have arith > geo, so the blend must too.
    expect(result.arithmeticMean).toBeGreaterThan(result.geometricReturn);
    // Volatility is blended independently; not a scaled version of return.
    expect(result.volatility).toBeGreaterThan(0);
  });
});
