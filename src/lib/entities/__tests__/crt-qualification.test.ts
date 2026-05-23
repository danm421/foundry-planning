import { describe, it, expect } from "vitest";
import { computeCrtQualificationWarnings } from "../crt-qualification";

describe("computeCrtQualificationWarnings", () => {
  const baseInput = {
    inceptionValue: 1_000_000,
    payoutType: "unitrust" as const,
    payoutPercent: 0.06,
    payoutAmount: undefined,
    irc7520Rate: 0.05,
    termType: "years" as const,
    termYears: 10,
    measuringLifeAge1: undefined,
    measuringLifeAge2: undefined,
    charitableDeduction: 538_615,
  };

  it("returns no warnings for a textbook qualified CRUT", () => {
    expect(computeCrtQualificationWarnings(baseInput)).toEqual([]);
  });

  it("warns when CRUT payout is below 5%", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutPercent: 0.04,
    });
    expect(warnings.some((w) => w.code === "payout_below_floor")).toBe(true);
  });

  it("does not warn at exactly 5% payout", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutPercent: 0.05,
    });
    expect(warnings.some((w) => w.code === "payout_below_floor")).toBe(false);
  });

  it("warns when CRUT payout is above 50%", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutPercent: 0.51,
    });
    expect(warnings.some((w) => w.code === "payout_above_ceiling")).toBe(true);
  });

  it("warns when CRAT year-1 payout is below 5% of inception", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 40_000,
    });
    expect(warnings.some((w) => w.code === "payout_below_floor")).toBe(true);
  });

  it("warns when remainder factor (= MRIT ratio) is below 10%", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      charitableDeduction: 90_000,
    });
    expect(warnings.some((w) => w.code === "mrit_below_floor")).toBe(true);
  });

  it("does not surface 5% probability warning for a term-certain CRAT", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 60_000,
      termType: "years",
      termYears: 10,
    });
    expect(warnings.some((w) => w.code === "exhaustion_probability")).toBe(false);
  });

  it("surfaces 5% probability warning for a lifetime CRAT that fails the test", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 100_000,
      termType: "single_life",
      termYears: undefined,
      measuringLifeAge1: 40,
    });
    expect(warnings.some((w) => w.code === "exhaustion_probability")).toBe(true);
  });

  it("does not surface 5% probability warning for a lifetime CRAT that passes the test", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 60_000,
      termType: "single_life",
      termYears: undefined,
      measuringLifeAge1: 85,
    });
    expect(warnings.some((w) => w.code === "exhaustion_probability")).toBe(false);
  });

  it("does not surface 5% probability warning for any CRUT (test is CRAT-only)", () => {
    const warnings = computeCrtQualificationWarnings({
      ...baseInput,
      payoutType: "unitrust",
      payoutPercent: 0.06,
      termType: "single_life",
      termYears: undefined,
      measuringLifeAge1: 40,
    });
    expect(warnings.some((w) => w.code === "exhaustion_probability")).toBe(false);
  });
});
