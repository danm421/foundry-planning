import { describe, it, expect } from "vitest";
import { buildTaxComparisonNarrative, type TaxComparisonNarrativeInput } from "../comparison-narrative";

const BASE: TaxComparisonNarrativeInput = {
  baselineLabel: "Base Case",
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

  // IRMAA is the 4th-priority signal and MAX_LINES caps the page at an opener
  // plus three, so BASE's rate/Roth/high-bracket signals crowd it out. Dropping
  // bracket mode frees the slot without touching the IRMAA inputs themselves.
  it("names the baseline in the IRMAA line rather than saying 'the base case'", () => {
    const lines = buildTaxComparisonNarrative({ ...BASE, bracketMode: false, baselineLabel: "Retire at 62" });
    expect(lines.join(" ")).toContain("vs 3 in Retire at 62");
    expect(lines.join(" ")).not.toContain("in the base case");
  });

  it("still says 'Base Case' for an ordinary base-baselined page", () => {
    expect(buildTaxComparisonNarrative({ ...BASE, bracketMode: false }).join(" ")).toContain("vs 3 in Base Case");
  });
});
