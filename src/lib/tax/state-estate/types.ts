/** USPS two-letter codes for jurisdictions that levy a state estate tax in 2026. */
export type StateCode =
  | "CT" | "DC" | "HI" | "IL" | "ME" | "MD" | "MA"
  | "MN" | "NY" | "OR" | "RI" | "VT" | "WA";

export interface Bracket {
  /** Lower bound (inclusive). Bottom bracket's `from` equals the exemption. */
  from: number;
  /** Upper bound (exclusive). `null` = no upper limit. */
  to: number | null;
  /** Marginal rate as decimal (0.16 = 16%). */
  rate: number;
}

export interface GiftAddback {
  /** Look-back window in years. `Infinity` for "all federal taxable gifts". */
  years: number;
  /** Which gift base feeds the addback. */
  basis: "federal-taxable" | "state-taxable";
}

export interface StateEstateTaxRule {
  state: StateCode;
  /** First death year these values apply to (most-recent rule with effectiveYear ≤ deathYear wins). */
  effectiveYear: number;
  exemption: number;
  /** Annotation only; runtime indexing is Phase 3. */
  indexed: boolean;
  brackets: Bracket[];
  giftAddback: GiftAddback | null;
  /** CT only — caps combined estate + gift tax. */
  capCombined?: number;
  /** NY — when taxable / exemption > cliffPct, entire estate becomes taxable. */
  cliffPct?: number;
  /** MA — first $exemption isn't fed into graduated brackets. */
  antiCliff?: boolean;
  /** Annotation surfaced in the audit-report notes; no runtime effect in Phase 1. */
  outOfState: "proportional-credit" | "limited-credit" | "deduct-from-gross" | "no-credit" | "foreign-only";
  citation: string;
}

export interface BracketLine {
  from: number;
  to: number;
  rate: number;
  amountTaxed: number;
  tax: number;
}

export interface StateEstateTaxResult {
  state: StateCode | null;
  /** True when the caller had no residenceState and a non-zero fallback rate was applied. */
  fallbackUsed: boolean;
  /** Marginal rate used in fallback mode; 0 otherwise. */
  fallbackRate: number;

  exemption: number;
  /** Year the exemption value comes from (rule.effectiveYear). */
  exemptionYear: number;
  giftAddback: number;
  baseForTax: number;
  amountOverExemption: number;

  bracketLines: BracketLine[];
  preCapTax: number;
  cap?: { applied: boolean; cap: number; reduction: number };
  cliff?: { applied: boolean; threshold: number };
  antiCliffCreditApplied?: boolean;

  stateEstateTax: number;
  /** Human-readable annotations for the audit report. */
  notes: string[];
}
