// Pure types for the tax engine. No runtime code, no DB imports.

export type FilingStatus = "married_joint" | "single" | "head_of_household" | "married_separate";

export interface BracketTier {
  from: number;       // inclusive lower bound
  to: number | null;  // exclusive upper bound; null for top bracket
  rate: number;       // e.g., 0.22 for 22%
}

export type BracketsByStatus = Record<FilingStatus, BracketTier[]>;

export interface CapGainsTier {
  zeroPctTop: number;
  fifteenPctTop: number;  // 20% applies above
}

export type CapGainsBracketsByStatus = Record<FilingStatus, CapGainsTier>;

// Mirrors the DB row shape but with parsed numbers (DB returns decimal as string).
export interface TaxYearParameters {
  year: number;

  incomeBrackets: BracketsByStatus;
  capGainsBrackets: CapGainsBracketsByStatus;

  stdDeduction: Record<FilingStatus, number>;

  amtExemption: { mfj: number; singleHoh: number; mfs: number };
  amtBreakpoint2628: { mfjShoh: number; mfs: number };
  amtPhaseoutStart: { mfj: number; singleHoh: number; mfs: number };

  ssTaxRate: number;
  ssWageBase: number;
  medicareTaxRate: number;
  addlMedicareRate: number;
  addlMedicareThreshold: { mfj: number; single: number; mfs: number };

  niitRate: number;
  niitThreshold: { mfj: number; single: number; mfs: number };

  qbi: {
    thresholdMfj: number;
    thresholdSingleHohMfs: number;
    phaseInRangeMfj: number;
    phaseInRangeOther: number;
  };

  contribLimits: {
    ira401kElective: number;
    ira401kCatchup50: number;
    ira401kCatchup6063: number | null;
    iraTradLimit: number;
    iraCatchup50: number;
    simpleLimitRegular: number;
    simpleCatchup50: number;
    hsaLimitSelf: number;
    hsaLimitFamily: number;
    hsaCatchup55: number;
  };
}

// Already-resolved engine input for one projection year.
export interface CalcInput {
  year: number;
  filingStatus: FilingStatus;
  // From projection engine's existing taxDetail:
  earnedIncome: number;
  ordinaryIncome: number;     // taxable interest, non-qual div, RMDs, etc.
  qualifiedDividends: number;
  longTermCapitalGains: number;
  shortTermCapitalGains: number;
  qbiIncome: number;
  taxExemptIncome: number;
  // Other inputs:
  socialSecurityGross: number;     // pre-taxability gross SS
  aboveLineDeductions: number;     // v1: 0
  itemizedDeductions: number;      // v1: 0 — falls back to standard
  flatStateRate: number;
  taxParams: TaxYearParameters;
  inflationFactor: number;         // for diag display
}

export interface TaxResult {
  income: {
    earnedIncome: number;
    taxableSocialSecurity: number;
    ordinaryIncome: number;
    dividends: number;
    capitalGains: number;
    shortCapitalGains: number;
    totalIncome: number;
    nonTaxableIncome: number;
    grossTotalIncome: number;
  };
  flow: {
    aboveLineDeductions: number;
    adjustedGrossIncome: number;
    qbiDeduction: number;
    belowLineDeductions: number;
    taxableIncome: number;
    incomeTaxBase: number;
    regularTaxCalc: number;
    amtCredit: number;
    taxCredits: number;
    regularFederalIncomeTax: number;
    capitalGainsTax: number;
    amtAdditional: number;
    niit: number;
    additionalMedicare: number;
    fica: number;
    stateTax: number;
    totalFederalTax: number;
    totalTax: number;
  };
  diag: {
    marginalFederalRate: number;
    effectiveFederalRate: number;
    bracketsUsed: TaxYearParameters;
    inflationFactor: number;
  };
}
