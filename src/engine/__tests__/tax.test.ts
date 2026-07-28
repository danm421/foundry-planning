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
  // C1: flat mode now runs the same §1222/§1211(b)/§1212(b) machinery as the
  // bracket path, so a supplied carryforward is CONSUMED rather than parroted
  // back. The by-reference guarantee still holds.
  it("consumes a supplied capital-loss carryforward and returns a fresh object", () => {
    const carryforwardIn = { shortTerm: 1, longTerm: 2 };
    const result = calculateTaxYearFlat({
      taxableIncome: 100_000,
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      taxParams: makeEmptyTaxParams(2026),
      longTermCapitalGains: 0,
      shortTermCapitalGains: 0,
      filingStatus: "married_joint",
      capitalLossCarryforwardIn: carryforwardIn,
    });
    // Total loss of 3 is well under the $3,000 cap, so it is fully absorbed.
    expect(result.capitalLoss.carryforwardOut).toEqual({ shortTerm: 0, longTerm: 0 });
    expect(result.capitalLoss.deduction).toBe(3);
    expect(result.capitalLoss.carryforwardConsumed).toBe(3);
    expect(result.flow.taxableIncome).toBe(99_997);
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
      longTermCapitalGains: 0,
      shortTermCapitalGains: 0,
      filingStatus: "married_joint",
    });
    expect(result.capitalLoss.carryforwardOut).toEqual({ shortTerm: 0, longTerm: 0 });
    expect(result.flow.taxableIncome).toBe(100_000);
  });
});
