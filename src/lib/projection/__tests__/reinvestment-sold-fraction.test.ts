import { describe, it, expect } from "vitest";
import { soldFraction } from "../reinvestment-sold-fraction";

describe("soldFraction", () => {
  it("sums the positive weight decreases", () => {
    // 75/25 large/intl  ->  50/50 large/intl : sold 25% of large
    const old = new Map([["large", 0.75], ["intl", 0.25]]);
    const next = new Map([["large", 0.5], ["intl", 0.5]]);
    expect(soldFraction(old, next)).toBeCloseTo(0.25);
  });

  it("returns 1 when the prior allocation is unknown", () => {
    expect(soldFraction(undefined, new Map([["large", 1]]))).toBe(1);
  });

  it("returns 1 when the new allocation is unknown (custom target)", () => {
    expect(soldFraction(new Map([["large", 1]]), undefined)).toBe(1);
  });

  it("is 0 for an identical allocation", () => {
    const m = new Map([["large", 0.6], ["bond", 0.4]]);
    expect(soldFraction(m, new Map(m))).toBeCloseTo(0);
  });

  it("counts an asset class that drops to zero", () => {
    const old = new Map([["large", 0.5], ["intl", 0.5]]);
    const next = new Map([["large", 1]]);
    expect(soldFraction(old, next)).toBeCloseTo(0.5);
  });
});
