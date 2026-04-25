import { describe, it, expect } from "vitest";
import { createTaxResolver } from "../resolver";
import type { TaxYearParameters } from "../types";

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

describe("createTaxResolver", () => {
  const rows = [makeRow(2026)];

  it("returns exact match with inflationFactor 1.0", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const out = r.getYear(2026);
    expect(out.inflationFactor).toBe(1.0);
    expect(out.params.stdDeduction.married_joint).toBe(32200);
  });

  it("inflates standard deduction forward and floors to step", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    // 2030: factor = 1.025^4 ≈ 1.10381, std MFJ = 32200 × 1.10381 ≈ 35543
    // Floor to $50: 35500
    const out = r.getYear(2030);
    expect(out.inflationFactor).toBeCloseTo(1.10381, 3);
    expect(out.params.stdDeduction.married_joint).toBe(35500);
  });

  it("inflates IRA limit and floors to $500", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    // 2030: 7500 × 1.10381 ≈ 8278.59 → floor to 500 = 8000
    const out = r.getYear(2030);
    expect(out.params.contribLimits.iraTradLimit).toBe(8000);
  });

  it("uses ssWageGrowthRate for SS wage base, not taxInflationRate", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.04 });
    // 2030: 184500 × 1.04^4 ≈ 215868 → floor to 300 = 215700
    const out = r.getYear(2030);
    expect(out.params.ssWageBase).toBe(215700);
  });

  it("does not inflate NIIT thresholds (statutorily fixed)", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const out = r.getYear(2050);
    expect(out.params.niitThreshold.mfj).toBe(250000);
    expect(out.params.addlMedicareThreshold.single).toBe(200000);
  });

  it("does not inflate rates", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const out = r.getYear(2050);
    expect(out.params.ssTaxRate).toBeCloseTo(0.062, 4);
    expect(out.params.medicareTaxRate).toBeCloseTo(0.0145, 4);
    expect(out.params.niitRate).toBeCloseTo(0.038, 4);
    expect(out.params.incomeBrackets.married_joint[2].rate).toBeCloseTo(0.22, 4);
  });

  it("inflates bracket from/to thresholds", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    // 2030: 24800 × 1.10381 ≈ 27374 → floor to 50 = 27350
    const out = r.getYear(2030);
    expect(out.params.incomeBrackets.married_joint[0].to).toBe(27350);
    expect(out.params.incomeBrackets.married_joint[1].from).toBe(27350);
  });

  it("memoizes per-year results", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const a = r.getYear(2030);
    const b = r.getYear(2030);
    expect(a).toBe(b); // same reference
  });
});
