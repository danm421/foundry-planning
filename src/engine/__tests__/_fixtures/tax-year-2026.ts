import type { TaxYearParameters } from "../../../lib/tax/types";

// 2026 MFJ-style brackets with the standard 7-tier ordinary-income schedule.
// The taxInflationRate (set on plan settings) auto-inflates downstream years.
export const TAX_YEAR_2026: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [
      { from: 0,      to: 23200,   rate: 0.10 },
      { from: 23200,  to: 94300,   rate: 0.12 },
      { from: 94300,  to: 201050,  rate: 0.22 },
      { from: 201050, to: 383900,  rate: 0.24 },
      { from: 383900, to: 487450,  rate: 0.32 },
      { from: 487450, to: 731200,  rate: 0.35 },
      { from: 731200, to: null,    rate: 0.37 },
    ],
    single: [
      { from: 0,      to: 11600,   rate: 0.10 },
      { from: 11600,  to: 47150,   rate: 0.12 },
      { from: 47150,  to: 100525,  rate: 0.22 },
      { from: 100525, to: 191950,  rate: 0.24 },
      { from: 191950, to: 243725,  rate: 0.32 },
      { from: 243725, to: 609350,  rate: 0.35 },
      { from: 609350, to: null,    rate: 0.37 },
    ],
    head_of_household: [{ from: 0, to: null, rate: 0.22 }],
    married_separate:  [{ from: 0, to: null, rate: 0.22 }],
  },
  capGainsBrackets: {
    married_joint:     { zeroPctTop: 94050,  fifteenPctTop: 583750 },
    single:            { zeroPctTop: 47025,  fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000,  fifteenPctTop: 551350 },
    married_separate:  { zeroPctTop: 47025,  fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [
    { from: 0,     to: 3300,  rate: 0.10 },
    { from: 3300,  to: 16250, rate: 0.37 },
    { from: 16250, to: null,  rate: 0.37 },
  ],
  trustCapGainsBrackets: [
    { from: 0,    to: 3350, rate: 0 },
    { from: 3350, to: null, rate: 0.20 },
  ],
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
};
