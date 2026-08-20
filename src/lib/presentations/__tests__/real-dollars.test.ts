import { describe, it, expect } from "vitest";
import {
  absoluteDollarDifference,
  dollarPair,
  sumDollarPairs,
  toTodaysDollars,
} from "../real-dollars";

const basis = { inflationRate: 0.03, planStartYear: 2026 };

describe("toTodaysDollars", () => {
  it("returns the nominal figure in the plan's first year", () => {
    expect(toTodaysDollars(100_000, 2026, basis)).toBe(100_000);
  });

  it("discounts a future figure by compounded inflation", () => {
    // 100_000 / 1.03^10 = 74_409.39...
    expect(toTodaysDollars(100_000, 2036, basis)).toBeCloseTo(74_409.39, 2);
  });

  it("does not inflate a figure dated before the plan starts", () => {
    expect(toTodaysDollars(100_000, 2020, basis)).toBe(100_000);
  });

  it("is a no-op at zero inflation", () => {
    expect(toTodaysDollars(100_000, 2066, { inflationRate: 0, planStartYear: 2026 })).toBe(100_000);
  });
});

describe("DollarPair", () => {
  it("preserves the engine's nominal result beside its today's-dollar value", () => {
    const pair = dollarPair(2_520_232, 2060, {
      inflationRate: 0.024,
      planStartYear: 2026,
    });

    expect(pair.nominal).toBe(2_520_232);
    expect(pair.today).toBeCloseTo(1_125_232, 0);
  });

  it("adds aggregates in their own units", () => {
    expect(
      sumDollarPairs([
        { today: 100, nominal: 120 },
        { today: 200, nominal: 260 },
      ]),
    ).toEqual({ today: 300, nominal: 380 });
  });

  it("measures an absolute gap in both units", () => {
    expect(
      absoluteDollarDifference(
        { today: 900, nominal: 1_500 },
        { today: 1_100, nominal: 1_900 },
      ),
    ).toEqual({ today: 200, nominal: 400 });
  });
});
