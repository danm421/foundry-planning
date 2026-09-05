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

  it("never projects the IRA catch-up below its indexed base year", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    // SECURE 2.0 §108 indexes the age-50 IRA catch-up (IRC §219(b)(5)(C)) in $100
    // steps; the 2026 base is $1,100. With the $500 step it shared before, 2027 was
    // 1100 × 1.025 = 1127.5 → floor 500 = 1000, i.e. BELOW the base year — the
    // inflation step silently undoing the indexation. Every projected year must be
    // at least the base.
    for (const year of [2027, 2030, 2040, 2060]) {
      expect(r.getYear(year).params.contribLimits.iraCatchup50).toBeGreaterThanOrEqual(1100);
    }
    // 2027: 1100 × 1.025 = 1127.5 → floor to 100 = 1100
    expect(r.getYear(2027).params.contribLimits.iraCatchup50).toBe(1100);
    // 2030: 1100 × 1.10381 ≈ 1214.2 → floor to 100 = 1200
    expect(r.getYear(2030).params.contribLimits.iraCatchup50).toBe(1200);
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

// tax-thresholds-credits Task 3: the five new threshold/credit parameter
// blocks must inflate forward for out-of-table years, same as every other
// indexed field. See resolver.ts inflateParams — these were previously a
// straight pass-through (TODO now closed for these five; Medicare premiums
// remain the one genuinely open gap).
describe("createTaxResolver — threshold/credit inflation", () => {
  function makeRowWithThresholds(year: number): TaxYearParameters {
    return {
      ...makeRow(year),
      rothPhaseout: { startMfj: 230000, endMfj: 240000, startSingle: 145000, endSingle: 160000 },
      iraDeduct: {
        coveredStartMfj: 125000, coveredEndMfj: 145000,
        coveredStartSingle: 78000, coveredEndSingle: 88000,
        spousalStartMfj: 230000, spousalEndMfj: 240000,
      },
      studentLoan: { maxDeduction: 2500, startMfj: 170000, endMfj: 200000, startSingle: 80000, endSingle: 95000 },
      ctc: { perChild: 2000, refundableMax: 1700, odcPerDependent: 500 },
      saversCredit: { mfj: [{ rate: 0.5, agiCeiling: 40000 }], single: [], hoh: [] },
    };
  }

  const seededRows = [makeRowWithThresholds(2026)];
  // 2030 = 4 years forward @ 2.5% → generalFactor ≈ 1.1038128906249995
  const rates = { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 };

  it("inflates the Roth phase-out range and floors to $1,000", () => {
    const r = createTaxResolver(seededRows, rates);
    const out = r.getYear(2030);
    expect(out.params.rothPhaseout).toEqual({
      startMfj: 253000, endMfj: 264000, startSingle: 160000, endSingle: 176000,
    });
  });

  it("inflates the IRA-deduction covered/spousal ranges and floors to $1,000", () => {
    const r = createTaxResolver(seededRows, rates);
    const out = r.getYear(2030);
    expect(out.params.iraDeduct).toEqual({
      coveredStartMfj: 137000, coveredEndMfj: 160000,
      coveredStartSingle: 86000, coveredEndSingle: 97000,
      spousalStartMfj: 253000, spousalEndMfj: 264000,
    });
  });

  it("inflates the student-loan range bounds but not maxDeduction", () => {
    const r = createTaxResolver(seededRows, rates);
    const out = r.getYear(2030);
    expect(out.params.studentLoan).toEqual({
      maxDeduction: 2500, // IRC 221(b)(1) — fixed since inception, never indexed
      startMfj: 187000, endMfj: 220000, startSingle: 88000, endSingle: 104000,
    });
  });

  it("inflates CTC perChild/refundableMax but not odcPerDependent", () => {
    const r = createTaxResolver(seededRows, rates);
    const out = r.getYear(2030);
    expect(out.params.ctc).toEqual({
      perChild: 2200, refundableMax: 1800,
      odcPerDependent: 500, // IRC 24(h)(4) — fixed, never indexed
    });
  });

  it("passes the Saver's Credit tiers through unchanged", () => {
    const r = createTaxResolver(seededRows, rates);
    const out = r.getYear(2030);
    expect(out.params.saversCredit).toEqual({
      mfj: [{ rate: 0.5, agiCeiling: 40000 }], single: [], hoh: [],
    });
  });

  it("keeps null threshold/credit fields null, not NaN, for an out-of-table year", () => {
    // makeRow() seeds all 21 new columns as null — the live state of the dev
    // DB today. An unguarded floorToStep(null * f, step) would produce NaN;
    // infN() must short-circuit instead.
    const r = createTaxResolver([makeRow(2026)], rates);
    const out = r.getYear(2030);
    expect(out.params.rothPhaseout).toEqual({
      startMfj: null, endMfj: null, startSingle: null, endSingle: null,
    });
    expect(out.params.iraDeduct).toEqual({
      coveredStartMfj: null, coveredEndMfj: null, coveredStartSingle: null,
      coveredEndSingle: null, spousalStartMfj: null, spousalEndMfj: null,
    });
    expect(out.params.studentLoan).toEqual({
      maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null,
    });
    expect(out.params.ctc).toEqual({ perChild: null, refundableMax: null, odcPerDependent: null });
  });

  it("returns an exact-match seeded year's threshold/credit fields untouched", () => {
    const r = createTaxResolver(seededRows, rates);
    const out = r.getYear(2026);
    expect(out.params.rothPhaseout).toEqual(seededRows[0].rothPhaseout);
    expect(out.params.iraDeduct).toEqual(seededRows[0].iraDeduct);
    expect(out.params.studentLoan).toEqual(seededRows[0].studentLoan);
    expect(out.params.ctc).toEqual(seededRows[0].ctc);
    expect(out.params.saversCredit).toEqual(seededRows[0].saversCredit);
  });
});
