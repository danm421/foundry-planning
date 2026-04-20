import type { taxYearParameters } from "../../db/schema";
import type { TaxYearParameters } from "./types";

type Row = typeof taxYearParameters.$inferSelect;

export function dbRowToTaxYearParameters(row: Row): TaxYearParameters {
  return {
    year: row.year,
    incomeBrackets: row.incomeBrackets as TaxYearParameters["incomeBrackets"],
    capGainsBrackets: row.capGainsBrackets as TaxYearParameters["capGainsBrackets"],
    stdDeduction: {
      married_joint: parseFloat(row.stdDeductionMfj),
      single: parseFloat(row.stdDeductionSingle),
      head_of_household: parseFloat(row.stdDeductionHoh),
      married_separate: parseFloat(row.stdDeductionMfs),
    },
    amtExemption: {
      mfj: parseFloat(row.amtExemptionMfj),
      singleHoh: parseFloat(row.amtExemptionSingleHoh),
      mfs: parseFloat(row.amtExemptionMfs),
    },
    amtBreakpoint2628: {
      mfjShoh: parseFloat(row.amtBreakpoint2628MfjShoh),
      mfs: parseFloat(row.amtBreakpoint2628Mfs),
    },
    amtPhaseoutStart: {
      mfj: parseFloat(row.amtPhaseoutStartMfj),
      singleHoh: parseFloat(row.amtPhaseoutStartSingleHoh),
      mfs: parseFloat(row.amtPhaseoutStartMfs),
    },
    ssTaxRate: parseFloat(row.ssTaxRate),
    ssWageBase: parseFloat(row.ssWageBase),
    medicareTaxRate: parseFloat(row.medicareTaxRate),
    addlMedicareRate: parseFloat(row.addlMedicareRate),
    addlMedicareThreshold: {
      mfj: parseFloat(row.addlMedicareThresholdMfj),
      single: parseFloat(row.addlMedicareThresholdSingle),
      mfs: parseFloat(row.addlMedicareThresholdMfs),
    },
    niitRate: parseFloat(row.niitRate),
    niitThreshold: {
      mfj: parseFloat(row.niitThresholdMfj),
      single: parseFloat(row.niitThresholdSingle),
      mfs: parseFloat(row.niitThresholdMfs),
    },
    qbi: {
      thresholdMfj: parseFloat(row.qbiThresholdMfj),
      thresholdSingleHohMfs: parseFloat(row.qbiThresholdSingleHohMfs),
      phaseInRangeMfj: parseFloat(row.qbiPhaseInRangeMfj),
      phaseInRangeOther: parseFloat(row.qbiPhaseInRangeOther),
    },
    contribLimits: {
      ira401kElective: parseFloat(row.ira401kElective),
      ira401kCatchup50: parseFloat(row.ira401kCatchup50),
      ira401kCatchup6063: row.ira401kCatchup6063 != null ? parseFloat(row.ira401kCatchup6063) : null,
      iraTradLimit: parseFloat(row.iraTradLimit),
      iraCatchup50: parseFloat(row.iraCatchup50),
      simpleLimitRegular: parseFloat(row.simpleLimitRegular),
      simpleCatchup50: parseFloat(row.simpleCatchup50),
      hsaLimitSelf: parseFloat(row.hsaLimitSelf),
      hsaLimitFamily: parseFloat(row.hsaLimitFamily),
      hsaCatchup55: parseFloat(row.hsaCatchup55),
    },
  };
}
