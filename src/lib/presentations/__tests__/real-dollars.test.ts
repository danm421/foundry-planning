import { describe, it, expect } from "vitest";
import { toTodaysDollars } from "../real-dollars";

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
