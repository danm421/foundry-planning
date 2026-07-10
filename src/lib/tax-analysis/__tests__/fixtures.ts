import type { TaxYearParameters } from "@/lib/tax/types";
import {
  emptyTaxReturnFacts,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";

/** Hand-entered 2025-shaped parameters (values realistic, test-local). */
export const params2025: TaxYearParameters = {
  year: 2025,
  incomeBrackets: {
    married_joint: [
      { from: 0, to: 23850, rate: 0.1 },
      { from: 23850, to: 96950, rate: 0.12 },
      { from: 96950, to: 206700, rate: 0.22 },
      { from: 206700, to: 394600, rate: 0.24 },
      { from: 394600, to: 501050, rate: 0.32 },
      { from: 501050, to: 751600, rate: 0.35 },
      { from: 751600, to: null, rate: 0.37 },
    ],
    single: [
      { from: 0, to: 11925, rate: 0.1 },
      { from: 11925, to: 48475, rate: 0.12 },
      { from: 48475, to: 103350, rate: 0.22 },
      { from: 103350, to: 197300, rate: 0.24 },
      { from: 197300, to: 250525, rate: 0.32 },
      { from: 250525, to: 626350, rate: 0.35 },
      { from: 626350, to: null, rate: 0.37 },
    ],
    head_of_household: [
      { from: 0, to: 17000, rate: 0.1 },
      { from: 17000, to: 64850, rate: 0.12 },
      { from: 64850, to: 103350, rate: 0.22 },
      { from: 103350, to: 197300, rate: 0.24 },
      { from: 197300, to: 250500, rate: 0.32 },
      { from: 250500, to: 626350, rate: 0.35 },
      { from: 626350, to: null, rate: 0.37 },
    ],
    married_separate: [
      { from: 0, to: 11925, rate: 0.1 },
      { from: 11925, to: 48475, rate: 0.12 },
      { from: 48475, to: 103350, rate: 0.22 },
      { from: 103350, to: 197300, rate: 0.24 },
      { from: 197300, to: 250525, rate: 0.32 },
      { from: 250525, to: 375800, rate: 0.35 },
      { from: 375800, to: null, rate: 0.37 },
    ],
  },
  capGainsBrackets: {
    married_joint: { zeroPctTop: 96700, fifteenPctTop: 600050 },
    single: { zeroPctTop: 48350, fifteenPctTop: 533400 },
    head_of_household: { zeroPctTop: 64750, fifteenPctTop: 566700 },
    married_separate: { zeroPctTop: 48350, fifteenPctTop: 300000 },
  },
  trustIncomeBrackets: [{ from: 0, to: null, rate: 0.37 }],
  trustCapGainsBrackets: [{ from: 0, to: null, rate: 0.2 }],
  stdDeduction: {
    married_joint: 30000,
    single: 15000,
    head_of_household: 22500,
    married_separate: 15000,
  },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1252700, singleHoh: 626350, mfs: 626350 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 394600,
    thresholdSingleHohMfs: 197300,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500, ira401kCatchup50: 7500, ira401kCatchup6063: 11250,
    iraTradLimit: 7000, iraCatchup50: 1000, simpleLimitRegular: 16500,
    simpleCatchup50: 3500, hsaLimitSelf: 4300, hsaLimitFamily: 8550,
    hsaCatchup55: 1000,
  },
  giftAnnualExclusion: 19000,
  standardPartBPremium: 2220,
  partDNationalBase: 480,
  irmaaBracketsMfj: [
    { tier: 1, magiLowerBound: 212000, magiUpperBound: 266000, partBSurcharge: 888, partDSurcharge: 160 },
    { tier: 2, magiLowerBound: 266000, magiUpperBound: 334000, partBSurcharge: 2220, partDSurcharge: 415 },
    { tier: 3, magiLowerBound: 334000, magiUpperBound: 400000, partBSurcharge: 3552, partDSurcharge: 670 },
    { tier: 4, magiLowerBound: 400000, magiUpperBound: 750000, partBSurcharge: 4884, partDSurcharge: 925 },
    { tier: 5, magiLowerBound: 750000, magiUpperBound: null, partBSurcharge: 5328, partDSurcharge: 1010 },
  ],
  irmaaBracketsSingle: [
    { tier: 1, magiLowerBound: 106000, magiUpperBound: 133000, partBSurcharge: 888, partDSurcharge: 160 },
    { tier: 2, magiLowerBound: 133000, magiUpperBound: 167000, partBSurcharge: 2220, partDSurcharge: 415 },
    { tier: 3, magiLowerBound: 167000, magiUpperBound: 200000, partBSurcharge: 3552, partDSurcharge: 670 },
    { tier: 4, magiLowerBound: 200000, magiUpperBound: 500000, partBSurcharge: 4884, partDSurcharge: 925 },
    { tier: 5, magiLowerBound: 500000, magiUpperBound: null, partBSurcharge: 5328, partDSurcharge: 1010 },
  ],
};

/** MFJ retirees, both 72: IRA draws + SS + investment income, standard deduction. */
export function retireeMfj(): TaxReturnFacts {
  const f = emptyTaxReturnFacts(2025);
  f.filingStatus = "married_joint";
  f.residenceState = "PA";
  f.income.taxableInterest = 8000;
  f.income.taxExemptInterest = 12000;
  f.income.ordinaryDividends = 18000;
  f.income.qualifiedDividends = 15000;
  f.income.iraDistributionsGross = 90000;
  f.income.iraDistributionsTaxable = 90000;
  f.income.ssBenefitsGross = 62000;
  f.income.ssBenefitsTaxable = 52700;
  f.income.capitalGainOrLoss = 20000;
  f.income.netLongTermGain = 20000;
  f.income.netShortTermGain = 0;
  f.income.agi = 188700;
  f.deductions.deductionTaken = "standard";
  f.deductions.deductionAmount = 33200;
  f.deductions.taxableIncome = 155500;
  f.tax.taxBeforeCredits = 21588;
  f.tax.totalTax = 21588;
  f.payments.withholding = 15000;
  f.payments.estimatedPayments = 4000;
  return f;
}

/** MFJ high earners, 2 kids under 17, itemized, near NIIT/addl-Medicare/CTC lines. */
export function highEarnerMfj(): TaxReturnFacts {
  const f = emptyTaxReturnFacts(2025);
  f.filingStatus = "married_joint";
  f.residenceState = "CA";
  f.dependentsUnder17 = 2;
  f.income.wages = 430000;
  f.income.taxableInterest = 3000;
  f.income.ordinaryDividends = 9000;
  f.income.qualifiedDividends = 9000;
  f.income.netLongTermGain = 25000;
  f.income.netShortTermGain = 0;
  f.income.capitalGainOrLoss = 25000;
  f.income.agi = 467000;
  f.deductions.deductionTaken = "itemized";
  f.deductions.deductionAmount = 36000;
  f.deductions.scheduleA = {
    saltPaid: 32000, saltDeducted: 10000, mortgageInterest: 22000,
    charitableCash: 4000, charitableNonCash: 0, medical: 0,
  };
  f.deductions.taxableIncome = 431000;
  f.tax.taxBeforeCredits = 91000;
  f.tax.niit = 1406;
  f.tax.additionalMedicareTax = 1620;
  f.tax.childTaxCredit = 650;
  f.tax.totalTax = 93376;
  f.payments.withholding = 88000;
  return f;
}

/** Single retiree, 66, MAGI $1,500 below the first single IRMAA cliff. */
export function singleNearIrmaa(): TaxReturnFacts {
  const f = emptyTaxReturnFacts(2025);
  f.filingStatus = "single";
  f.income.iraDistributionsGross = 95000;
  f.income.iraDistributionsTaxable = 95000;
  f.income.ssBenefitsGross = 30000;
  f.income.ssBenefitsTaxable = 25500;
  f.income.taxableInterest = 4000;
  f.income.agi = 104500;
  f.deductions.deductionTaken = "standard";
  f.deductions.deductionAmount = 17000;
  f.deductions.taxableIncome = 87500;
  f.tax.taxBeforeCredits = 14000;
  f.tax.totalTax = 14000;
  f.payments.withholding = 15500;
  return f;
}
