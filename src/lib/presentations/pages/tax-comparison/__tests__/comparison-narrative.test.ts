import { describe, it, expect } from "vitest";
import { buildTaxComparisonNarrative, type TaxComparisonNarrativeInput } from "../comparison-narrative";

const BASE: TaxComparisonNarrativeInput = {
  baseLifetimeTotal: 2_200_000, scnLifetimeTotal: 1_888_000,
  baseEffectiveRate: 0.21, scnEffectiveRate: 0.18,
  baseRothAtRet: 100_000, scnRothAtRet: 580_000,
  bracketMode: true,
  baseYearsAboveHigh: 7, scnYearsAboveHigh: 2,
  baseYearsBelowLow: 1, scnYearsBelowLow: 4,
  lowThreshold: 0.22, highThreshold: 0.24,
  baseIrmaaYears: 3, scnIrmaaYears: 1,
};

describe("buildTaxComparisonNarrative", () => {
  it("opens with the lifetime-tax reduction in $ and %", () => {
    const lines = buildTaxComparisonNarrative(BASE);
    expect(lines[0]).toContain("lowers");
    expect(lines[0]).toContain("$312k");
    expect(lines[0]).toContain("14%");
  });

  it("opens with an increase when the scenario costs more", () => {
    const lines = buildTaxComparisonNarrative({ ...BASE, baseLifetimeTotal: 1_888_000, scnLifetimeTotal: 2_200_000 });
    expect(lines[0]).toContain("raises");
  });

  it("calls a sub-$1k swing essentially unchanged", () => {
    const lines = buildTaxComparisonNarrative({ ...BASE, baseLifetimeTotal: 2_000_000, scnLifetimeTotal: 2_000_500 });
    expect(lines[0]).toContain("essentially unchanged");
  });

  it("reports the Roth shift, high-bracket-year cut, and caps at 4 lines", () => {
    const lines = buildTaxComparisonNarrative(BASE);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines.join(" ")).toContain("Roth");
    expect(lines.join(" ")).toContain("24%");
  });

  it("omits bracket-year signals in flat-tax mode", () => {
    const lines = buildTaxComparisonNarrative({ ...BASE, bracketMode: false });
    expect(lines.join(" ")).not.toContain("bracket");
  });
});
