import { describe, it, expect } from "vitest";
import { projectFmv, resolveStrikePrice } from "../price-model";

describe("projectFmv", () => {
  it("returns base price at the start year", () => {
    expect(projectFmv(100, 0.07, 2026, 2026)).toBeCloseTo(100);
  });
  it("compounds growth forward", () => {
    expect(projectFmv(100, 0.07, 2029, 2026)).toBeCloseTo(100 * 1.07 ** 3, 6);
  });
  it("never projects backward (past years clamp to base)", () => {
    expect(projectFmv(100, 0.07, 2024, 2026)).toBeCloseTo(100);
  });
});

describe("resolveStrikePrice", () => {
  it("uses an explicit strike", () => {
    expect(resolveStrikePrice({ strikePrice: 10, strikeDiscountPct: null }, 50)).toBe(10);
  });
  it("applies a discount to FMV when no explicit strike", () => {
    expect(resolveStrikePrice({ strikePrice: null, strikeDiscountPct: 0.15 }, 50)).toBeCloseTo(42.5);
  });
  it("defaults to 0 strike when neither is set (e.g. an RSU)", () => {
    expect(resolveStrikePrice({ strikePrice: null, strikeDiscountPct: null }, 50)).toBe(0);
  });
});
