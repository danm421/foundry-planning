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
  "contribLimits.simpleLimitRegular": 500,
  "contribLimits.simpleCatchup50": 500,
  "contribLimits.hsaCatchup55": 500,  // statutory $1000, but use $500 if it ever indexes

  // IRA catch-up: $100. SECURE 2.0 Act §108 made the age-50 IRA catch-up indexed
  // (IRC §219(b)(5)(C)), in $100 increments — first applied for 2026 at $1,100.
  // It must NOT share the $500 step above: flooring 1,100 × inflation to $500
  // lands on $1,000, i.e. below the 2026 base, so every projected year would
  // silently regress the catch-up back to its pre-indexing value.
  "contribLimits.iraCatchup50": 100,

  // SS wage base: $300 per SSA formula
  ssWageBase: 300,

  // Threshold/credit phase-out ranges: $1,000 steps
  "rothPhaseout.startMfj": 1000,
  "rothPhaseout.endMfj": 1000,
  "rothPhaseout.startSingle": 1000,
  "rothPhaseout.endSingle": 1000,
  "iraDeduct.coveredStartMfj": 1000,
  "iraDeduct.coveredEndMfj": 1000,
  "iraDeduct.coveredStartSingle": 1000,
  "iraDeduct.coveredEndSingle": 1000,
  "iraDeduct.spousalStartMfj": 1000,
  "iraDeduct.spousalEndMfj": 1000,
  "studentLoan.startMfj": 1000,
  "studentLoan.endMfj": 1000,
  "studentLoan.startSingle": 1000,
  "studentLoan.endSingle": 1000,
  "ctc.perChild": 100,
  "ctc.refundableMax": 100,
  // studentLoan.maxDeduction and ctc.odcPerDependent are NOT indexed.
};

// Floor a number to the nearest step (e.g., floorToStep(8278.78, 500) = 8000).
export function floorToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

/** IRC §1(h) preferential rates, applied when a cap-gains tier carries no
 *  override. Seeded `cap_gains_brackets` rows store only the two THRESHOLDS
 *  (zeroPctTop, fifteenPctTop), so these two rates are the fallback every
 *  preferential calculation lands on. They live here rather than beside the
 *  rate stressor that first needed them: capGains.ts is a core primitive and
 *  must not depend on a feature module for a statutory constant. */
export const STATUTORY_MID_RATE = 0.15;
export const STATUTORY_TOP_RATE = 0.20;

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

  // IRC 24(b) — unindexed since TCJA. Reduction is $50 per $1,000 OR FRACTION.
  ctcPhaseoutThresholdMfj: 400000,
  ctcPhaseoutThresholdOther: 200000,
  ctcReductionPerStep: 50,
  ctcReductionStep: 1000,

  // IRC 25A(i)/(b) — unindexed since 2009.
  aotcMaxPerStudent: 2500,
  aotcFullCreditExpenses: 2000,   // 100% of the first $2,000
  aotcPartialCreditExpenses: 2000, // 25% of the next $2,000
  aotcPartialRate: 0.25,
  aotcPhaseoutStartMfj: 160000,
  aotcPhaseoutEndMfj: 180000,
  aotcPhaseoutStartOther: 80000,
  aotcPhaseoutEndOther: 90000,
  aotcRefundableRate: 0.4,
  aotcRefundableCap: 1000,
  aotcMaxYearsPerStudent: 4,

  // IRC 221(b)(1) — the student-loan interest ceiling. Fixed at $2,500 since
  // inception and never inflation-indexed (unlike the 221(b)(2) MAGI range,
  // which is). Serves as the fallback when the DB column is unseeded.
  studentLoanMaxDeduction: 2500,

  // IRC 408A(c)(3)(B) / 219(g)(3)(B) — MFS range, never indexed.
  mfsPhaseoutStart: 0,
  mfsPhaseoutEnd: 10000,

  // IRC 25B — per-person contribution considered.
  saversMaxContributionPerPerson: 2000,
  /** SECURE 2.0 §103 replaces the credit with the Saver's Match after 2026. */
  saversCreditLastYear: 2026,

  // IRC 24(d) — ACTC earned-income formula.
  actcEarnedIncomeFloor: 2500,
  actcEarnedIncomeRate: 0.15,
} as const;

// AMT exemption phase-out rate.
// - Pre-2026: 25% of (AMTI - threshold) (TCJA).
// - 2026+: 50% per OBBBA §70106. This is the big difference: a MFJ client at
//   AMTI $1.4M above the threshold loses ~2× as much exemption.
export function amtPhaseoutRate(year: number): number {
  return year >= 2026 ? 0.5 : 0.25;
}

// SS taxability formula constants (per IRS Pub 915).
export const SS_TAXABILITY = {
  base1: { single: 25000, mfj: 32000, mfs: 0 },
  base2: { single: 34000, mfj: 44000, mfs: 0 },
  // mfs has special "lived together" rules; we treat as 0 thresholds → 85% taxable.
};

// §1211(b) annual limit on the net capital loss deductible against ordinary
// income. Fixed by statute since 1978 and never inflation-indexed, so it lives
// here rather than in the seeded TaxYearParameters.
export const CAPITAL_LOSS_ORDINARY_LIMIT = 3000;
export const CAPITAL_LOSS_ORDINARY_LIMIT_MFS = 1500;
