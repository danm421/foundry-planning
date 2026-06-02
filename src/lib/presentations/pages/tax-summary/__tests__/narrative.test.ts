import { describe, it, expect } from "vitest";
import { buildTaxNarrative, type TaxNarrativeInput } from "../narrative";

const base: TaxNarrativeInput = {
  lifetimeTotal: 800_000,
  effectiveRate: 0.18,
  bracketMode: true,
  yearsBelowLow: 0,
  yearsAboveHigh: 0,
  lowThreshold: 0.22,
  highThreshold: 0.24,
  rothConversionTotal: 0,
  rothConversionYears: 0,
  rothFirstYear: null,
  rothLastYear: null,
  irmaaYears: 0,
  irmaaTotal: 0,
  largestGain: null,
};

describe("buildTaxNarrative", () => {
  it("always opens with the lifetime total + effective rate", () => {
    const lines = buildTaxNarrative(base);
    expect(lines[0]).toContain("$800k");
    expect(lines[0]).toContain("18%");
  });

  it("prioritizes Roth, high-bracket, IRMAA, gains, then low-bracket, capped at 4 lines", () => {
    const lines = buildTaxNarrative({
      ...base,
      yearsBelowLow: 5,
      yearsAboveHigh: 3,
      rothConversionTotal: 250_000,
      rothConversionYears: 6,
      rothFirstYear: 2030,
      rothLastYear: 2035,
      irmaaYears: 4,
      irmaaTotal: 8_000,
      largestGain: { year: 2032, gain: 120_000, tax: 18_000 },
    });
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines[0]).not.toContain("Roth");      // opener stays — does not contain Roth
    // Opener is line 0; Roth is the first *signal* line.
    expect(lines[1]).toContain("Roth");
  });

  it("suppresses bracket lines when not in bracket mode", () => {
    const lines = buildTaxNarrative({ ...base, bracketMode: false, yearsBelowLow: 9, yearsAboveHigh: 9 });
    expect(lines.join(" ")).not.toContain("bracket");
  });
});
