// src/lib/tax/state-income/__tests__/cap-gains.test.ts
import { describe, it, expect } from "vitest";
import { computeCapGainsAdjustment, computeWaCapGainsTax } from "../cap-gains";

describe("computeCapGainsAdjustment", () => {
  it("AR exempts 50% of LTCG", () => {
    expect(computeCapGainsAdjustment("AR", { ltcg: 100_000, stcg: 0 })).toBe(50_000);
  });
  it("MT exempts 30% of LTCG", () => {
    expect(computeCapGainsAdjustment("MT", { ltcg: 100_000, stcg: 0 })).toBe(30_000);
  });
  it("ND exempts 40% of LTCG", () => {
    expect(computeCapGainsAdjustment("ND", { ltcg: 100_000, stcg: 0 })).toBe(40_000);
  });
  it("WI exempts 30% of LTCG", () => {
    expect(computeCapGainsAdjustment("WI", { ltcg: 100_000, stcg: 0 })).toBe(30_000);
  });
  it("CA has no carve-out", () => {
    expect(computeCapGainsAdjustment("CA", { ltcg: 100_000, stcg: 0 })).toBe(0);
  });
  it("does not exempt STCG", () => {
    expect(computeCapGainsAdjustment("AR", { ltcg: 0, stcg: 50_000 })).toBe(0);
  });
  it("clamps negative LTCG to 0", () => {
    expect(computeCapGainsAdjustment("AR", { ltcg: -10_000, stcg: 0 })).toBe(0);
  });
});

describe("computeWaCapGainsTax", () => {
  it("applies 7% on first $1M, 9% above", () => {
    expect(computeWaCapGainsTax(500_000)).toBe(35_000);
    expect(computeWaCapGainsTax(1_500_000)).toBe(70_000 + 45_000);
  });
  it("returns 7% × $1M at the exact $1M boundary", () => {
    expect(computeWaCapGainsTax(1_000_000)).toBe(70_000);
  });
  it("returns 0 for $0 or negative", () => {
    expect(computeWaCapGainsTax(0)).toBe(0);
    expect(computeWaCapGainsTax(-50_000)).toBe(0);
  });
});
