// Pure types for the tax engine. No runtime code, no DB imports.

export type FilingStatus = "married_joint" | "single" | "head_of_household" | "married_separate";

/** CMS IRMAA bracket tier. Mirrored from `src/engine/types.ts` so this file
 *  stays the leaf type module (engine/types.ts already imports from here). */
export interface IrmaaTier {
  tier: number;
  magiLowerBound: number;
  magiUpperBound: number | null;
  partBSurcharge: number;
  partDSurcharge: number;
}

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

  /** Compressed Form 1041 ordinary brackets (10/24/35/37). */
  trustIncomeBrackets: BracketTier[];

  /** Compressed IRC §1(h) LTCG / qualified-dividend brackets (0/15/20). */
  trustCapGainsBrackets: BracketTier[];

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

  /**
   * §2503(b) annual gift-tax exclusion for the year. Null = not seeded.
   * Consumed by the gift ledger / adjusted-taxable-gifts via
   * `buildAnnualExclusionMap`, which forward-projects out-years from the latest
   * seeded value (audit F2).
   */
  giftAnnualExclusion?: number | null;

  // ── Medicare (CMS-published; null until seeded for that year) ──────────────
  /** Annual standard Part B premium. Null = not seeded for this year. */
  standardPartBPremium?: number | null;
  /** Annual Part D national base beneficiary premium. Null = not seeded. */
  partDNationalBase?: number | null;
  /** IRMAA bracket tiers for married-filing-jointly filers. Null = not seeded. */
  irmaaBracketsMfj?: IrmaaTier[] | null;
  /** IRMAA bracket tiers for all other filers (statutorily "single" tier). Null = not seeded. */
  irmaaBracketsSingle?: IrmaaTier[] | null;
}

// Already-resolved engine input for one projection year.
export interface CalcInput {
  year: number;
  filingStatus: FilingStatus;
  // From projection engine's existing taxDetail:
  earnedIncome: number;
  ordinaryIncome: number;     // non-qual div, RMDs, IRA distributions, etc.
  /** Taxable interest income (savings, CDs, bonds). Split out from
   *  `ordinaryIncome` so NIIT can include it per IRC §1411(c)(1)(A)(i);
   *  the generic ordinaryIncome bucket still holds IRA/RMD/SE income which
   *  do NOT count as net investment income. Optional for back-compat —
   *  callers that haven't migrated treat interest as buried in ordinary. */
  interestIncome?: number;
  qualifiedDividends: number;
  longTermCapitalGains: number;
  shortTermCapitalGains: number;
  qbiIncome: number;
  taxExemptIncome: number;
  /** Municipal-bond / tax-exempt interest only — the narrow §86 "combined
   *  income" / IRMAA-MAGI subset of taxExemptIncome (IRC §86(b)(2)(B); Pub 915
   *  Worksheet 1 line 3 = Form 1040 line 2a). Excludes the broad non-taxable
   *  bucket (Roth-equivalent / return-of-capital / non-taxable business
   *  pass-through), which is NOT part of §86 combined income. Optional for
   *  back-compat — callers that omit it fall back to taxExemptIncome (the old,
   *  over-inclusive behaviour that over-taxes SS). */
  taxExemptInterest?: number;
  // Other inputs:
  socialSecurityGross: number;     // pre-taxability gross SS
  aboveLineDeductions: number;     // v1: 0
  itemizedDeductions: number;      // v1: 0 — falls back to standard
  flatStateRate: number;
  taxParams: TaxYearParameters;
  inflationFactor: number;         // for diag display
  /** Per-source retirement income breakdown for state-income-tax exclusion rules.
   *  db = pension/deferred income; ira = traditional IRA RMDs/withdrawals;
   *  k401 = 401k/403b RMDs/withdrawals; annuity = annuity income. */
  retirementBreakdown?: {
    db: number;
    ira: number;
    k401: number;
    annuity: number;
  };
  /** Residence state for the bracket-mode state income tax engine. */
  residenceState?: import("@/lib/usps-states").USPSStateCode | null;
  primaryAge?: number;
  spouseAge?: number;
  /** ISO exercise bargain element (FMV − strike at exercise). An AMT preference
   *  item: added to AMTI but NOT to regular taxable income. v1: no dual-basis /
   *  AMT credit carryforward. */
  isoSpread?: number;
  /** Capped SALT actually deducted on Schedule A (state/local income + property,
   *  post-§164 cap). Disallowed for AMT (IRC §56(b)(1)(A)(ii) / Form 6251 line 2a).
   *  Only meaningful for itemizers; standard-deduction add-back is handled separately.
   *  Itemizing callers MUST supply this — when omitted it defaults to 0, understating AMTI
   *  (the SALT add-back is silently skipped). */
  saltDeducted?: number;
}

export interface TaxResult {
  income: {
    earnedIncome: number;
    taxableSocialSecurity: number;
    ordinaryIncome: number;
    dividends: number;
    capitalGains: number;
    shortCapitalGains: number;
    qbi: number;
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
    /** Early-withdrawal penalty (10%) — transfer penalty + gap-fill supplemental
     *  penalty. Included in totalTax/totalFederalTax. 0 when no pre-59½ draws. */
    earlyWithdrawalPenalty: number;
  };
  diag: {
    marginalFederalRate: number;
    /** The full bracket tier the next dollar of ordinary income lands in.
     *  Lets reports show how much of the bracket is filled vs. remaining
     *  without re-walking BracketsByStatus and worrying about which filing
     *  status the engine actually used (flips at first-death). */
    marginalBracketTier: BracketTier;
    /** The bracket list actually applied this year (filing-status resolved).
     *  Mirrors the input the marginal-rate calc walks. Reports that need to
     *  classify `incomeTaxBase` with different boundary semantics (e.g. the
     *  "filled tier" the last dollar paid into, vs the marginal "next dollar"
     *  tier) can walk this list directly. */
    incomeBracketsForFiling: BracketTier[];
    effectiveFederalRate: number;
    bracketsUsed: TaxYearParameters;
    inflationFactor: number;
  };
  /** State income-tax detail (bracket-mode engine). Always populated;
   *  when residenceState is null, contains the fallback flat-rate result. */
  state?: import("./state-income").StateIncomeTaxResult;
}
