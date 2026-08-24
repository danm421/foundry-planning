import { describe, it, expect } from "vitest";
import { buildTaxResolver } from "../build-resolver";
import { rateStressParams } from "./fixtures";

// taxInflationRate/ssWageGrowthRate are pinned at 0 so a future-year lookup
// still goes through inflateParams (factor 1.0) without moving any threshold —
// this file is about RATES, and a moving threshold would only add noise.
const SETTINGS = { inflationRate: 0.03, taxInflationRate: 0, ssWageGrowthRate: 0 };

describe("buildTaxResolver", () => {
  it("returns null when there are no seeded rows", () => {
    expect(buildTaxResolver([], SETTINGS)).toBeNull();
  });

  it("resolves unstressed rates with no stressor configured", () => {
    const r = buildTaxResolver([rateStressParams()], SETTINGS)!;
    expect(r.getYear(2035).params.incomeBrackets.married_joint[0].rate).toBe(0.10);
  });

  it("leaves years before the start year unstressed", () => {
    const r = buildTaxResolver([rateStressParams()], {
      ...SETTINGS,
      taxRateStress: { points: 0.03, startYear: 2030 },
    })!;
    expect(r.getYear(2029).params.incomeBrackets.married_joint[0].rate).toBe(0.10);
  });

  it("stresses years at and after the start year", () => {
    const r = buildTaxResolver([rateStressParams()], {
      ...SETTINGS,
      taxRateStress: { points: 0.03, startYear: 2030 },
    })!;
    expect(r.getYear(2030).params.incomeBrackets.married_joint[0].rate).toBeCloseTo(0.13, 10);
    expect(r.getYear(2040).params.incomeBrackets.married_joint[0].rate).toBeCloseTo(0.13, 10);
  });

  it("does not leak a stressed year into an unstressed one through the cache", () => {
    const r = buildTaxResolver([rateStressParams()], {
      ...SETTINGS,
      taxRateStress: { points: 0.03, startYear: 2030 },
    })!;
    // Resolve the stressed year FIRST, then the unstressed one. A cache keyed
    // or populated wrongly would hand back the stressed row for 2029.
    expect(r.getYear(2030).params.incomeBrackets.married_joint[0].rate).toBeCloseTo(0.13, 10);
    expect(r.getYear(2029).params.incomeBrackets.married_joint[0].rate).toBe(0.10);
  });

  it("stresses the exact seeded year too, not only inflated future years", () => {
    const r = buildTaxResolver([rateStressParams()], {
      ...SETTINGS,
      taxRateStress: { points: 0.03, startYear: 2026 },
    })!;
    // 2026 is an EXACT row match — the resolver's early-return path. A stressor
    // applied only on the inflate-forward branch would miss it entirely.
    expect(r.getYear(2026).params.incomeBrackets.married_joint[0].rate).toBeCloseTo(0.13, 10);
  });

  it("carries the raised preferential rates through the inflated-year path", () => {
    // 2040 is NOT a seeded row, so it goes through inflateParams — which rebuilds
    // capGainsBrackets field-by-field from {zeroPctTop, fifteenPctTop} and would
    // DROP midRate/topRate if the stress were applied before it. This is the only
    // assertion in this file that discriminates the two orderings.
    const r = buildTaxResolver([rateStressParams()], {
      ...SETTINGS,
      taxRateStress: { points: 0.03, startYear: 2030 },
    })!;
    const cg = r.getYear(2040).params.capGainsBrackets.married_joint;
    expect(cg.midRate).toBeCloseTo(0.18, 10);
    expect(cg.topRate).toBeCloseTo(0.23, 10);
  });
});

describe("buildTaxResolver — the past-year fallback path", () => {
  it("stresses a year EARLIER than the earliest seeded row", () => {
    // resolver.ts has three return paths — exact year, past year, inflated
    // future year — and the stressor has to be applied on all three. The
    // past-year one is defensive (the engine validates planStartYear >=
    // currentYear) and was the one no test reached: deleting its
    // `applyTaxRateStress` call left every other test in this file green.
    const r = buildTaxResolver([rateStressParams()], {
      ...SETTINGS,
      taxRateStress: { points: 0.03, startYear: 2019 },
    })!;
    // The single seeded row is 2026, so 2020 falls off the bottom.
    expect(r.getYear(2020).sourceYear).toBe(2026);
    expect(r.getYear(2020).params.incomeBrackets.married_joint[0].rate).toBeCloseTo(0.13, 10);
  });

  it("leaves a past year alone when the stressor starts later", () => {
    // Guards the test above from passing on a transform that ignores startYear.
    const r = buildTaxResolver([rateStressParams()], {
      ...SETTINGS,
      taxRateStress: { points: 0.03, startYear: 2030 },
    })!;
    expect(r.getYear(2020).params.incomeBrackets.married_joint[0].rate).toBe(0.10);
  });
});
