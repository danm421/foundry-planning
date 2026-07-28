import { describe, it, expect } from "vitest";
import { calculateTaxes, calculateTaxYearFlat, makeEmptyTaxParams } from "../tax";
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

describe("calculateTaxYearFlat", () => {
  it("passes a supplied capital-loss carryforward through untouched, not by reference", () => {
    const carryforwardIn = { shortTerm: 1, longTerm: 2 };
    const result = calculateTaxYearFlat({
      taxableIncome: 100_000,
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      taxParams: makeEmptyTaxParams(2026),
      capitalLossCarryforwardIn: carryforwardIn,
    });
    expect(result.capitalLoss.carryforwardOut).toEqual({ shortTerm: 1, longTerm: 2 });
    // Flat mode has no gain/loss detail of its own to net this year.
    expect(result.capitalLoss.deduction).toBe(0);
    expect(result.capitalLoss.carryforwardConsumed).toBe(0);
    // Must be a fresh object — mutating the result must not corrupt the
    // caller's input (a year-loop reuses/mutates carryforwardOut downstream).
    expect(result.capitalLoss.carryforwardOut).not.toBe(carryforwardIn);
  });

  it("defaults the carryforward to zero when the caller omits it", () => {
    const result = calculateTaxYearFlat({
      taxableIncome: 100_000,
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      taxParams: makeEmptyTaxParams(2026),
    });
    expect(result.capitalLoss.carryforwardOut).toEqual({ shortTerm: 0, longTerm: 0 });
  });
});
