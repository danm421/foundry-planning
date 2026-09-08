import { describe, it, expect } from "vitest";
import {
  discountedGiftValue,
  normalizeValuationDiscount,
} from "../apply-valuation-discount";

describe("discountedGiftValue", () => {
  it("applies a 30% discount to a $1,000,000 interest (the worked example)", () => {
    expect(discountedGiftValue(1_000_000, 0.3)).toBe(700_000);
  });

  it("treats null as no discount", () => {
    expect(discountedGiftValue(1_000_000, null)).toBe(1_000_000);
  });

  it("treats undefined as no discount", () => {
    expect(discountedGiftValue(1_000_000, undefined)).toBe(1_000_000);
  });

  it("treats an explicit 0 as no discount — identical to null", () => {
    expect(discountedGiftValue(1_000_000, 0)).toBe(1_000_000);
    expect(discountedGiftValue(1_000_000, 0)).toBe(discountedGiftValue(1_000_000, null));
  });

  it("clamps a 100% discount to a $0 gift, never a negative one", () => {
    expect(discountedGiftValue(1_000_000, 1)).toBe(0);
  });

  it("clamps an out-of-range discount above 1 to a $0 gift, never a negative one", () => {
    expect(discountedGiftValue(1_000_000, 1.5)).toBe(0);
    expect(discountedGiftValue(1_000_000, 42)).toBe(0);
  });

  it("ignores a negative discount rather than inflating the gift", () => {
    expect(discountedGiftValue(1_000_000, -0.1)).toBe(1_000_000);
  });

  it("ignores NaN rather than producing NaN", () => {
    expect(discountedGiftValue(1_000_000, Number.NaN)).toBe(1_000_000);
  });

  it("passes a zero full value straight through", () => {
    expect(discountedGiftValue(0, 0.3)).toBe(0);
  });
});

describe("normalizeValuationDiscount", () => {
  it("returns the fraction unchanged when in range", () => {
    expect(normalizeValuationDiscount(0.3)).toBe(0.3);
    expect(normalizeValuationDiscount(0.9999)).toBe(0.9999);
  });

  it("returns 0 for null, undefined, zero, negatives and NaN", () => {
    expect(normalizeValuationDiscount(null)).toBe(0);
    expect(normalizeValuationDiscount(undefined)).toBe(0);
    expect(normalizeValuationDiscount(0)).toBe(0);
    expect(normalizeValuationDiscount(-0.25)).toBe(0);
    expect(normalizeValuationDiscount(Number.NaN)).toBe(0);
  });

  it("clamps at 1", () => {
    expect(normalizeValuationDiscount(1)).toBe(1);
    expect(normalizeValuationDiscount(3)).toBe(1);
  });
});
