import { describe, it, expect } from "vitest";
import { calcStateTax } from "../state";

describe("calcStateTax (flat)", () => {
  it("returns 0 for non-positive taxable income", () => {
    expect(calcStateTax(0, 0.05)).toBe(0);
    expect(calcStateTax(-100, 0.05)).toBe(0);
  });

  it("applies flat rate to taxable income", () => {
    expect(calcStateTax(100000, 0.05)).toBeCloseTo(5000, 2);
  });

  it("returns 0 with 0 rate (e.g., FL/TX)", () => {
    expect(calcStateTax(500000, 0)).toBe(0);
  });
});
