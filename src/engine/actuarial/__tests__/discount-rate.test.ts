import { describe, it, expect } from "vitest";
import { resolvePvDiscountRate } from "../discount-rate";

describe("resolvePvDiscountRate", () => {
  it("uses pvDiscountRate when set", () => {
    expect(resolvePvDiscountRate({ pvDiscountRate: 0.04, inflationRate: 0.03 })).toBe(0.04);
  });
  it("falls back to inflationRate when pvDiscountRate is null/undefined", () => {
    expect(resolvePvDiscountRate({ pvDiscountRate: undefined, inflationRate: 0.03 })).toBe(0.03);
  });
  it("falls back to 0 when both are missing", () => {
    expect(resolvePvDiscountRate({ pvDiscountRate: undefined, inflationRate: undefined as unknown as number })).toBe(0);
  });
});
