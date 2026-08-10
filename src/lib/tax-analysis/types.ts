import type { TaxResult, TaxYearParameters } from "@/lib/tax/types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { BracketMap } from "./bracket-map";
import type { ActivityDetail } from "./activity-detail";

export type FindingSeverity = "opportunity" | "watch" | "info";

/** The advisor-facing shelf a finding sits on, rendered as a chip. `deductions`
 *  is a ninth value beyond the spec's interface sketch — `charitable-bunching`
 *  has no honest home among the other eight. */
export type FindingCategory =
  | "brackets"
  | "retirement"
  | "business"
  | "real-estate"
  | "investments"
  | "credits"
  | "withholding"
  | "state"
  | "deductions";

/** One citation. `amount` is read STRAIGHT from facts and never computed —
 *  that is what makes lineRefs the audit trail for the prose rather than a
 *  second place the arithmetic can be wrong. `line` may be a descriptive
 *  phrase ("qualified business income") when a form has two numberings or the
 *  line moves year to year; it is never a guessed number. */
export interface FindingLineRef {
  form: string;
  line: string;
  label: string;
  amount: number | null;
}

export interface Finding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  /** One line, the claim itself. Doubles as the jump-link text in the index. */
  headline: string;
  /** The figures, sourced. Complete sentences, client-readable, dollar values
   *  interpolated at build time — never {placeholders}. */
  whatTheReturnShows: string;
  /** The mechanism. Why those figures produce a consequence. */
  whyItMatters: string;
  /** The action, hedged to what the return actually supports. */
  whatToConsider: string;
  lineRefs: FindingLineRef[];
  /**
   * The dollar magnitude this finding puts in play for ONE year — tax saved,
   * tax exposed, credit lost, or cash mis-stated. Deliberately broader than
   * "tax saved" so a cash-flow mis-statement and a penalty exposure sort
   * sensibly instead of sinking to the null tail. Null when the return does not
   * support a figure. Every builder's prose SAYS what its number is.
   */
  estimatedImpact: number | null;
  /** Unchanged contract (spec §5). The PDF never reads it; it is the
   *  test-assertion surface for every derived figure. */
  numbers: Record<string, number>;
}

export interface FindingContext {
  facts: TaxReturnFacts;
  prior: TaxReturnFacts | null;
  /** Params for facts.taxYear (exact seeded year for 2022+). */
  params: TaxYearParameters;
  /** Params for facts.taxYear + 2 — IRMAA's 2-year MAGI lookback. */
  irmaaParams: TaxYearParameters;
  /** Ages at END of the tax year; null when DOB unknown. */
  primaryAge: number | null;
  spouseAge: number | null;
  /** Engine run over these facts, computed once in buildTaxAnalysis and
   *  shared across findings — null when filingStatus is unknown. */
  calc: TaxResult | null;
  /** Bracket positioning, computed once in buildTaxAnalysis and shared
   *  across findings — null when taxableIncome/filingStatus is missing. */
  bracketMap: BracketMap | null;
  /** Gross-to-net per activity, computed once in buildTaxAnalysis. The rental
   *  cash-flow add-back and the suspended-loss memo live here already:
   *  rental-cash-vs-paper CONSUMES this, it does not recompute. The rental net
   *  is the filed Schedule 1 line 5, never gross − expenses (see
   *  activity-detail.ts:87-90). */
  activityDetail: ActivityDetail[] | null;
}
