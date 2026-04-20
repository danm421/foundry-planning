import { describe, it, expect } from "vitest";
import { calculateTaxes } from "../tax";
import { basePlanSettings } from "./fixtures";

describe("calculateTaxes", () => {
  it("applies combined federal + state rate to taxable income", () => {
    const tax = calculateTaxes(100000, basePlanSettings);
    // 22% federal + 5% state = 27%
    expect(tax).toBe(27000);
  });

  it("returns 0 for zero income", () => {
    expect(calculateTaxes(0, basePlanSettings)).toBe(0);
  });

  it("returns 0 for negative income", () => {
    expect(calculateTaxes(-5000, basePlanSettings)).toBe(0);
  });

  it("uses custom rates from settings", () => {
    const settings = { ...basePlanSettings, flatFederalRate: 0.10, flatStateRate: 0.03 };
    expect(calculateTaxes(200000, settings)).toBe(26000);
  });
});
