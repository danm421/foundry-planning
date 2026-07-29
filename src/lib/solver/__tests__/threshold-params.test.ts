import { describe, it, expect } from "vitest";
import { resolveThresholdParams } from "../threshold-params";
import type { ClientData } from "@/engine/types";
import type { TaxYearParameters } from "@/lib/tax/types";

// Mirrors src/lib/tax/__tests__/resolver.test.ts's fixture rather than
// inventing a second one — createTaxResolver's inflateParams touches every
// field unconditionally (except the nullable threshold/credit blocks), so a
// partial row would throw or silently produce NaN.
function makeRow(year: number): TaxYearParameters {
  return {
    year,
    incomeBrackets: {
      married_joint: [
        { from: 0, to: 24800, rate: 0.10 },
        { from: 24800, to: 100800, rate: 0.12 },
        { from: 100800, to: null, rate: 0.22 },
      ],
      single: [{ from: 0, to: null, rate: 0.10 }],
      head_of_household: [{ from: 0, to: null, rate: 0.10 }],
      married_separate: [{ from: 0, to: null, rate: 0.10 }],
    },
    capGainsBrackets: {
      married_joint: { zeroPctTop: 99200, fifteenPctTop: 615900 },
      single: { zeroPctTop: 49600, fifteenPctTop: 547500 },
      head_of_household: { zeroPctTop: 66450, fifteenPctTop: 581550 },
      married_separate: { zeroPctTop: 49600, fifteenPctTop: 307950 },
    },
    trustIncomeBrackets: [],
    trustCapGainsBrackets: [],
    stdDeduction: { married_joint: 32200, single: 16100, head_of_household: 24150, married_separate: 16100 },
    amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
    amtBreakpoint2628: { mfjShoh: 244500, mfs: 122250 },
    amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
    ssTaxRate: 0.062,
    ssWageBase: 184500,
    medicareTaxRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038,
    niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: { thresholdMfj: 405000, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
    rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    iraDeduct: { coveredStartMfj: null, coveredEndMfj: null, coveredStartSingle: null,
                 coveredEndSingle: null, spousalStartMfj: null, spousalEndMfj: null },
    studentLoan: { maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
    saversCredit: { mfj: [], single: [], hoh: [] },
    contribLimits: {
      ira401kElective: 24500,
      ira401kCatchup50: 8000,
      ira401kCatchup6063: 11250,
      iraTradLimit: 7500,
      iraCatchup50: 1100,
      simpleLimitRegular: 17000,
      simpleCatchup50: 4000,
      hsaLimitSelf: 4400,
      hsaLimitFamily: 8750,
      hsaCatchup55: 1000,
    },
  };
}

function tree(planSettings: Partial<ClientData["planSettings"]>, taxYearRows?: TaxYearParameters[]): ClientData {
  return {
    taxYearRows,
    planSettings: {
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      planStartYear: 2026,
      planEndYear: 2060,
      ...planSettings,
    },
  } as unknown as ClientData;
}

describe("resolveThresholdParams", () => {
  // Seed year 2026, target year 2030 — 4 years forward. Every expected value
  // below is hand-computed (not derived from calling createTaxResolver) so a
  // mutation to the fallback chain in threshold-params.ts changes the output
  // this test compares against, per resolver.ts's own verified math.

  it("[R5] uses an explicit ssWageGrowthRate for the SS wage base, not inflationRate + 0.005", () => {
    // inflationRate fallback would be 0.025 + 0.005 = 0.03 -> floor(184500 * 1.03^4, 300) = 207600.
    // The explicit rate (0.04) must win instead -> floor(184500 * 1.04^4, 300) = 215700.
    const t = tree(
      { inflationRate: 0.025, taxInflationRate: 0.025, ssWageGrowthRate: 0.04 },
      [makeRow(2026)],
    );
    const params = resolveThresholdParams(t, 2030);
    expect(params?.ssWageBase).toBe(215700);
  });

  it("[R5] falls back to inflationRate + 0.005 for the SS wage base when ssWageGrowthRate is absent", () => {
    // No ssWageGrowthRate supplied -> must fall back to 0.025 + 0.005 = 0.03.
    // floor(184500 * 1.03^4, 300) = 207600. If the fallback were dropped (e.g.
    // defaulted to inflationRate alone, 0.025), this would read 207350 instead.
    const t = tree(
      { inflationRate: 0.025, taxInflationRate: 0.025, ssWageGrowthRate: undefined },
      [makeRow(2026)],
    );
    const params = resolveThresholdParams(t, 2030);
    expect(params?.ssWageBase).toBe(207600);
  });

  it("[R5] uses an explicit taxInflationRate for the general inflation factor, not inflationRate", () => {
    // inflationRate is deliberately set far from taxInflationRate (0.05 vs
    // 0.025) so a mutant that read the wrong field lands on a different
    // number: floor(32200 * 1.05^4, 50) = 39100 vs the correct 35500.
    const t = tree(
      { inflationRate: 0.05, taxInflationRate: 0.025, ssWageGrowthRate: 0.03 },
      [makeRow(2026)],
    );
    const params = resolveThresholdParams(t, 2030);
    expect(params?.stdDeduction.married_joint).toBe(35500);
  });

  it("[R5] falls back to inflationRate for the general inflation factor when taxInflationRate is absent", () => {
    // No taxInflationRate supplied -> must fall back to inflationRate (0.03).
    // floor(32200 * 1.03^4, 50) = 36200.
    const t = tree(
      { inflationRate: 0.03, taxInflationRate: undefined, ssWageGrowthRate: 0.03 },
      [makeRow(2026)],
    );
    const params = resolveThresholdParams(t, 2030);
    expect(params?.stdDeduction.married_joint).toBe(36200);
  });

  it("[R5/R6] returns null when taxYearRows is missing or empty (flat-mode fallback)", () => {
    const emptyRows = tree({ inflationRate: 0.025 }, []);
    expect(resolveThresholdParams(emptyRows, 2030)).toBeNull();

    const missingRows = tree({ inflationRate: 0.025 }, undefined);
    expect(resolveThresholdParams(missingRows, 2030)).toBeNull();
  });
});
