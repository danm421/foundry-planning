// src/lib/tax/resolver.ts
import type { TaxYearParameters } from "./types";
import { ROUNDING_STEPS, floorToStep } from "./constants";

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

export function createTaxResolver(rows: TaxYearParameters[], rates: ResolverRates): TaxResolver {
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
        const out = { params: exact, inflationFactor: 1.0, sourceYear: year };
        cache.set(year, out);
        return out;
      }

      // Past year — fall back to earliest (defensive; engine validates planStartYear >= currentYear)
      if (year < sorted[0].year) {
        const out = { params: sorted[0], inflationFactor: 1.0, sourceYear: sorted[0].year };
        cache.set(year, out);
        return out;
      }

      // Future year — inflate latest forward
      const yearsForward = year - latest.year;
      const generalFactor = Math.pow(1 + rates.taxInflationRate, yearsForward);
      const ssFactor = Math.pow(1 + rates.ssWageGrowthRate, yearsForward);

      const inflated = inflateParams(latest, generalFactor, ssFactor);
      const out = { params: inflated, inflationFactor: generalFactor, sourceYear: latest.year };
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
  };
}
