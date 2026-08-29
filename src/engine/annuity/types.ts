export type AnnuityProductType =
  | "spia" | "dia" | "myga" | "fixed" | "fixed_indexed" | "variable" | "qlac";

export type AnnuityTaxTreatment = "qualified" | "non_qualified" | "tax_free";

export type AnnuityIncomeMode = "none" | "rider" | "annuitized";

export type AnnuityPayoutStructure =
  | "single_life" | "joint_survivor" | "life_with_period_certain"
  | "period_certain" | "cash_refund";

/** Engine-facing contract. Rides on `Account.annuity`. All rates are
 *  fractions (0.05 = 5%), all money is a plain number. */
export interface AnnuityContract {
  carrier?: string | null;
  contractNumberLast4?: string | null;
  productType: AnnuityProductType;
  taxTreatment: AnnuityTaxTreatment;
  /** Investment in the contract (§72 basis). Undefined = unknown; callers
   *  seed it to the account's value at plan start so no phantom gain appears. */
  costBasis?: number;
  surrenderChargePct?: number;
  surrenderEndYear?: number | null;
  annualFeePct: number;
  incomeMode: AnnuityIncomeMode;
  /** Already resolved from incomeStartYearRef by the loader. */
  incomeStartYear?: number | null;
  payoutStructure?: AnnuityPayoutStructure | null;
  survivorPct?: number | null;
  periodCertainYears?: number | null;
  benefitBase?: number;
  rollupRate?: number;
  rollupEndYear?: number | null;
  rollupRatchets: boolean;
  riderFeePct?: number;
  /** Undefined = derive from the age band table. */
  payoutPct?: number;
  annuitizedPayment?: number;
  /** Undefined = derive from the mortality table. */
  expectedReturnYears?: number;
}

/** Mutable per-year state the projection threads alongside accountBalances. */
export interface AnnuityState {
  accountValue: number;
  benefitBase: number;
  /** Unrecovered §72 basis. Drives LIFO and the §72(b)(2) exclusion cap. */
  remainingBasis: number;
  /** Cumulative tax-free dollars already excluded. Compared against the
   *  original investment in the contract for the §72(b)(2) cap. */
  cumulativeExcluded: number;
  incomeActive: boolean;
  /** Year income turned on. Undefined while accumulating. Drives period-certain
   *  expiry. */
  activationYear?: number;
  /** Locked at activation; never recomputed afterward. */
  guaranteedIncome: number;
  /** Fixed at the annuity starting date; 0 when not annuitized. */
  lockedExclusionRatio: number;
  /** The original investment in the contract, frozen for the §72(b)(2) cap. */
  investmentInContract: number;
}

/** How one distribution splits for tax. `capitalGains` is deliberately absent:
 *  an annuity distribution is ALWAYS ordinary income, never a capital gain. */
export interface AnnuityTaxSplit {
  ordinaryIncome: number;
  /** Tax-free return of basis. */
  basisReturn: number;
  earlyWithdrawalPenalty: number;
}
