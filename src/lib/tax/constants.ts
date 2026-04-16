// Rounding steps for indexed tax fields. Derived from historical IRS practice
// (verified against 2022-2026 deltas in data/tax/2022-2026 Tax Values Updated.xlsx).
// When inflating thresholds forward, floor to the nearest step.
//
// Fields NOT in this map stay constant (NIIT thresholds, addl Medicare thresholds,
// all rates).

export const ROUNDING_STEPS: Record<string, number> = {
  // Income brackets: $50 (smallest historical delta increment)
  incomeBrackets: 50,
  capGainsBrackets: 50,
  stdDeductionMfj: 50,
  stdDeductionSingle: 50,
  stdDeductionHoh: 50,
  stdDeductionMfs: 50,

  // QBI thresholds and phase-in ranges
  "qbi.thresholdMfj": 50,
  "qbi.thresholdSingleHohMfs": 50,
  "qbi.phaseInRangeMfj": 50,
  "qbi.phaseInRangeOther": 50,

  // HSA: $50
  "contribLimits.hsaLimitSelf": 50,
  "contribLimits.hsaLimitFamily": 50,

  // AMT: $100
  "amtExemption.mfj": 100,
  "amtExemption.singleHoh": 100,
  "amtExemption.mfs": 100,
  "amtBreakpoint2628.mfjShoh": 100,
  "amtBreakpoint2628.mfs": 100,
  "amtPhaseoutStart.mfj": 100,
  "amtPhaseoutStart.singleHoh": 100,
  "amtPhaseoutStart.mfs": 100,

  // 401k/IRA/SIMPLE: $500
  "contribLimits.ira401kElective": 500,
  "contribLimits.ira401kCatchup50": 500,
  "contribLimits.ira401kCatchup6063": 500,
  "contribLimits.iraTradLimit": 500,
  "contribLimits.iraCatchup50": 500,
  "contribLimits.simpleLimitRegular": 500,
  "contribLimits.simpleCatchup50": 500,
  "contribLimits.hsaCatchup55": 500,  // statutory $1000, but use $500 if it ever indexes

  // SS wage base: $300 per SSA formula
  ssWageBase: 300,
};

// Floor a number to the nearest step (e.g., floorToStep(8278.78, 500) = 8000).
export function floorToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

// Statutorily-fixed values not stored in the spreadsheet (fixed by Congress
// since 2013; intentionally NOT indexed for inflation).
export const STATUTORY_FIXED = {
  niitRate: 0.038,
  niitThresholdMfj: 250000,
  niitThresholdSingle: 200000,
  niitThresholdMfs: 125000,
  addlMedicareRate: 0.009,
  addlMedicareThresholdMfj: 250000,
  addlMedicareThresholdSingle: 200000,
  addlMedicareThresholdMfs: 125000,
} as const;

// AMT exemption applies the phase-out at 25% of (AMTI - threshold).
export const AMT_PHASEOUT_RATE = 0.25;

// SS taxability formula constants (per IRS Pub 915).
export const SS_TAXABILITY = {
  base1: { single: 25000, mfj: 32000, mfs: 0 },
  base2: { single: 34000, mfj: 44000, mfs: 0 },
  // mfs has special "lived together" rules; we treat as 0 thresholds → 85% taxable.
};
