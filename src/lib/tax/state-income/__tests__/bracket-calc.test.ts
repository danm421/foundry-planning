// src/lib/tax/state-income/__tests__/bracket-calc.test.ts
import { describe, it, expect } from "vitest";
import { applyBrackets } from "../bracket-calc";

describe("applyBrackets", () => {
  it("returns 0 on $0 income", () => {
    expect(applyBrackets(0, [{ from: 0, to: null, rate: 0.05 }])).toBe(0);
  });
  it("applies a flat single-tier rate", () => {
    expect(applyBrackets(100_000, [{ from: 0, to: null, rate: 0.05 }])).toBe(5_000);
  });
  it("stacks tiers correctly", () => {
    // Alabama Single: 2% to 500, 4% to 3000, 5% above
    const al = [
      { from: 0, to: 500, rate: 0.02 },
      { from: 500, to: 3000, rate: 0.04 },
      { from: 3000, to: null, rate: 0.05 },
    ];
    expect(applyBrackets(10_000, al)).toBeCloseTo(500 * 0.02 + 2500 * 0.04 + 7000 * 0.05, 4);
    expect(applyBrackets(2_000, al)).toBeCloseTo(500 * 0.02 + 1500 * 0.04, 4);
  });
});
