// src/lib/tax/resolver.ts
import type { TaxYearParameters } from "./types";
import { ROUNDING_STEPS, floorToStep } from "./constants";
import { applyTaxRateStress, type TaxRateStress } from "./rate-stress";

export interface ResolverRates {
  taxInflationRate: number;   // for everything except SS wage base
  ssWageGrowthRate: number;   // for SS wage base
}

export interface ResolvedYear {
  params: TaxYearParameters;
  inflationFactor: number;     // for diag display
  sourceYear: number;
}

export interface TaxResolver {
  getYear(year: number): ResolvedYear;
}

export function createTaxResolver(
  rows: TaxYearParameters[],
  rates: ResolverRates,
  /** Optional "tax rates rise" stressor. Absent = today's behaviour, which is
   *  what src/lib/tax-returns/load-analysis-context.ts relies on: it resolves
   *  parameters for ACTUAL FILED RETURNS and must never see a hypothetical. */
  stress?: TaxRateStress,
): TaxResolver {
  if (rows.length === 0) throw new Error("createTaxResolver: no tax_year_parameters rows provided");
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  const latest = sorted[sorted.length - 1];
  const cache = new Map<number, ResolvedYear>();

  return {
    getYear(year: number): ResolvedYear {
      const cached = cache.get(year);
      if (cached) return cached;

      // Exact match
      const exact = sorted.find((r) => r.year === year);
      if (exact) {
        // applyTaxRateStress never mutates, so `exact` — a caller-owned row —
        // is safe to hand it. Unstressed years get the same object back.
        const out = { params: applyTaxRateStress(exact, stress, year), inflationFactor: 1.0, sourceYear: year };
        cache.set(year, out);
        return out;
      }

      // Past year — fall back to earliest (defensive; engine validates planStartYear >= currentYear)
      if (year < sorted[0].year) {
        const out = { params: applyTaxRateStress(sorted[0], stress, year), inflationFactor: 1.0, sourceYear: sorted[0].year };
        cache.set(year, out);
        return out;
      }

      // Future year — inflate latest forward
      const yearsForward = year - latest.year;
      const generalFactor = Math.pow(1 + rates.taxInflationRate, yearsForward);
      const ssFactor = Math.pow(1 + rates.ssWageGrowthRate, yearsForward);

      // ORDER IS LOAD-BEARING: stress AFTER inflating, never before. inflateParams
      // rebuilds capGainsBrackets field-by-field, emitting only zeroPctTop and
      // fifteenPctTop — it would silently drop the stressor's midRate/topRate,
      // leaving preferential rates unstressed while ordinary rates rose.
      const inflated = inflateParams(latest, generalFactor, ssFactor);
      const out = { params: applyTaxRateStress(inflated, stress, year), inflationFactor: generalFactor, sourceYear: latest.year };
      cache.set(year, out);
      return out;
    },
  };
}

function inflateParams(base: TaxYearParameters, generalFactor: number, ssFactor: number): TaxYearParameters {
  const inf = (val: number, key: string): number => {
    const step = ROUNDING_STEPS[key];
    if (!step) return val; // not indexed — return as-is
    return floorToStep(val * generalFactor, step);
  };
  // Null-safe wrapper: the 21 new threshold/credit columns are `number | null`
  // (unseeded until the workbook is loaded). An unguarded floorToStep(null * f,
  // step) yields NaN, so every one of those fields must go through this rather
  // than `inf` directly.
  const infN = (val: number | null, key: string): number | null =>
    val == null ? null : inf(val, key);

  return {
    year: base.year, // logical "source year" for the params; resolver tracks the requested year separately
    incomeBrackets: {
      married_joint: base.incomeBrackets.married_joint.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
      single: base.incomeBrackets.single.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
      head_of_household: base.incomeBrackets.head_of_household.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
      married_separate: base.incomeBrackets.married_separate.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
    },
    capGainsBrackets: {
      married_joint: {
        zeroPctTop: floorToStep(base.capGainsBrackets.married_joint.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.married_joint.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
      single: {
        zeroPctTop: floorToStep(base.capGainsBrackets.single.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.single.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
      head_of_household: {
        zeroPctTop: floorToStep(base.capGainsBrackets.head_of_household.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.head_of_household.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
      married_separate: {
        zeroPctTop: floorToStep(base.capGainsBrackets.married_separate.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.married_separate.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
    },
    // TODO(Task 4/5): inflate trust brackets once real values flow through.
    trustIncomeBrackets: base.trustIncomeBrackets,
    trustCapGainsBrackets: base.trustCapGainsBrackets,
    stdDeduction: {
      married_joint: inf(base.stdDeduction.married_joint, "stdDeductionMfj"),
      single: inf(base.stdDeduction.single, "stdDeductionSingle"),
      head_of_household: inf(base.stdDeduction.head_of_household, "stdDeductionHoh"),
      married_separate: inf(base.stdDeduction.married_separate, "stdDeductionMfs"),
    },
    amtExemption: {
      mfj: inf(base.amtExemption.mfj, "amtExemption.mfj"),
      singleHoh: inf(base.amtExemption.singleHoh, "amtExemption.singleHoh"),
      mfs: inf(base.amtExemption.mfs, "amtExemption.mfs"),
    },
    amtBreakpoint2628: {
      mfjShoh: inf(base.amtBreakpoint2628.mfjShoh, "amtBreakpoint2628.mfjShoh"),
      mfs: inf(base.amtBreakpoint2628.mfs, "amtBreakpoint2628.mfs"),
    },
    amtPhaseoutStart: {
      mfj: inf(base.amtPhaseoutStart.mfj, "amtPhaseoutStart.mfj"),
      singleHoh: inf(base.amtPhaseoutStart.singleHoh, "amtPhaseoutStart.singleHoh"),
      mfs: inf(base.amtPhaseoutStart.mfs, "amtPhaseoutStart.mfs"),
    },
    ssTaxRate: base.ssTaxRate,
    ssWageBase: floorToStep(base.ssWageBase * ssFactor, ROUNDING_STEPS.ssWageBase),
    medicareTaxRate: base.medicareTaxRate,
    addlMedicareRate: base.addlMedicareRate,
    addlMedicareThreshold: base.addlMedicareThreshold, // statutorily fixed
    niitRate: base.niitRate,
    niitThreshold: base.niitThreshold, // statutorily fixed
    qbi: {
      thresholdMfj: inf(base.qbi.thresholdMfj, "qbi.thresholdMfj"),
      thresholdSingleHohMfs: inf(base.qbi.thresholdSingleHohMfs, "qbi.thresholdSingleHohMfs"),
      phaseInRangeMfj: inf(base.qbi.phaseInRangeMfj, "qbi.phaseInRangeMfj"),
      phaseInRangeOther: inf(base.qbi.phaseInRangeOther, "qbi.phaseInRangeOther"),
    },
    contribLimits: {
      ira401kElective: inf(base.contribLimits.ira401kElective, "contribLimits.ira401kElective"),
      ira401kCatchup50: inf(base.contribLimits.ira401kCatchup50, "contribLimits.ira401kCatchup50"),
      ira401kCatchup6063: base.contribLimits.ira401kCatchup6063 == null ? null : inf(base.contribLimits.ira401kCatchup6063, "contribLimits.ira401kCatchup6063"),
      iraTradLimit: inf(base.contribLimits.iraTradLimit, "contribLimits.iraTradLimit"),
      iraCatchup50: inf(base.contribLimits.iraCatchup50, "contribLimits.iraCatchup50"),
      simpleLimitRegular: inf(base.contribLimits.simpleLimitRegular, "contribLimits.simpleLimitRegular"),
      simpleCatchup50: inf(base.contribLimits.simpleCatchup50, "contribLimits.simpleCatchup50"),
      hsaLimitSelf: inf(base.contribLimits.hsaLimitSelf, "contribLimits.hsaLimitSelf"),
      hsaLimitFamily: inf(base.contribLimits.hsaLimitFamily, "contribLimits.hsaLimitFamily"),
      hsaCatchup55: inf(base.contribLimits.hsaCatchup55, "contribLimits.hsaCatchup55"),
    },
    // Medicare premiums and IRMAA brackets pass through unchanged. CMS publishes
    // them annually; for years beyond the seeded table the engine uses the latest
    // values literally (the medigap/Part-D inflation happens inside
    // computeMedicareYear via medicarePremiumInflationRate; the Part B portion is
    // not auto-inflated here — future work if needed).
    standardPartBPremium: base.standardPartBPremium ?? null,
    partDNationalBase: base.partDNationalBase ?? null,
    irmaaBracketsMfj: base.irmaaBracketsMfj ?? null,
    irmaaBracketsSingle: base.irmaaBracketsSingle ?? null,
    // IRC 408A(c)(3) Roth MAGI phase-out. All four fields index with inflation.
    rothPhaseout: {
      startMfj: infN(base.rothPhaseout.startMfj, "rothPhaseout.startMfj"),
      endMfj: infN(base.rothPhaseout.endMfj, "rothPhaseout.endMfj"),
      startSingle: infN(base.rothPhaseout.startSingle, "rothPhaseout.startSingle"),
      endSingle: infN(base.rothPhaseout.endSingle, "rothPhaseout.endSingle"),
    },
    // IRC 219(g) traditional-IRA deduction phase-outs. All six fields index.
    iraDeduct: {
      coveredStartMfj: infN(base.iraDeduct.coveredStartMfj, "iraDeduct.coveredStartMfj"),
      coveredEndMfj: infN(base.iraDeduct.coveredEndMfj, "iraDeduct.coveredEndMfj"),
      coveredStartSingle: infN(base.iraDeduct.coveredStartSingle, "iraDeduct.coveredStartSingle"),
      coveredEndSingle: infN(base.iraDeduct.coveredEndSingle, "iraDeduct.coveredEndSingle"),
      spousalStartMfj: infN(base.iraDeduct.spousalStartMfj, "iraDeduct.spousalStartMfj"),
      spousalEndMfj: infN(base.iraDeduct.spousalEndMfj, "iraDeduct.spousalEndMfj"),
    },
    // IRC 221 student-loan interest deduction. The four range bounds index;
    // maxDeduction does NOT — IRC 221(b)(1) fixes the cap at $2,500 and it
    // has never been indexed.
    studentLoan: {
      maxDeduction: base.studentLoan.maxDeduction,
      startMfj: infN(base.studentLoan.startMfj, "studentLoan.startMfj"),
      endMfj: infN(base.studentLoan.endMfj, "studentLoan.endMfj"),
      startSingle: infN(base.studentLoan.startSingle, "studentLoan.startSingle"),
      endSingle: infN(base.studentLoan.endSingle, "studentLoan.endSingle"),
    },
    // IRC 24 child tax credit. perChild/refundableMax index; odcPerDependent
    // does NOT — IRC 24(h)(4) fixes the other-dependent credit at $500.
    ctc: {
      perChild: infN(base.ctc.perChild, "ctc.perChild"),
      refundableMax: infN(base.ctc.refundableMax, "ctc.refundableMax"),
      odcPerDependent: base.ctc.odcPerDependent,
    },
    // IRC 25B Saver's Credit tiers pass through UNCHANGED, deliberately — no
    // ROUNDING_STEPS entry exists for this field. SECURE 2.0 §103 replaces the
    // Saver's Credit with the Saver's Match after 2026, so statusFor() returns
    // "na" for any year past STATUTORY_FIXED.saversCreditLastYear. Inflating
    // tiers that can never be read for an out-of-table year would be noise.
    saversCredit: base.saversCredit,
  };
}
