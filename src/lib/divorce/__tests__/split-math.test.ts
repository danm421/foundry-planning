import { describe, it, expect } from "vitest";
import { splitAmounts } from "../split-math";

describe("splitAmounts", () => {
  it("pro-rates value, basis, rothValue by pct", () => {
    const r = splitAmounts(600_000, 200_000, 0, 40);
    expect(r.spouse).toEqual({ value: 240_000, basis: 80_000, rothValue: 0 });
    expect(r.primary).toEqual({ value: 360_000, basis: 120_000, rothValue: 0 });
  });
  it("conserves to the cent on awkward fractions", () => {
    const r = splitAmounts(100.01, 33.33, 10.01, 33.3333);
    expect(r.primary.value + r.spouse.value).toBeCloseTo(100.01, 10);
    expect(r.primary.basis + r.spouse.basis).toBeCloseTo(33.33, 10);
    expect(r.primary.rothValue + r.spouse.rothValue).toBeCloseTo(10.01, 10);
    // spouse share is rounded to cents; primary takes the exact remainder
    expect(r.spouse.value).toBe(Math.round(100.01 * 0.333333 * 100) / 100);
  });
});
