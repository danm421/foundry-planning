// src/lib/tax/explain-tax-change/types.ts
// Payload types for the year-over-year tax-change diagnostic. Pure — no IO.

/** Hide delta lines smaller than this (noise floor). */
export const LINE_FLOOR = 100;
/** Cap on bySource delta rows returned to the model. */
export const SOURCE_CAP = 12;
/** An account ledger ending below this is treated as depleted. */
export const DEPLETED_EPS = 100;
/** |Δ total tax| below this ⇒ "no significant change". */
export const MATERIALITY = 500;

export const money = (n: number) =>
  `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
export const pct = (r: number) => `${Math.round(r * 100)}%`;

export interface DollarDelta {
  label: string;
  from: number;
  to: number;
  delta: number;
}

export type TaxChangeCauseKind =
  | "withdrawal_shift"
  | "rmd"
  | "roth_conversion"
  | "social_security"
  | "realized_gains"
  | "filing_status_change"
  | "deduction_change"
  | "state_move";

/** What a detector returns — assembly adds estimatedTaxImpact. */
export interface TaxChangeFinding {
  kind: TaxChangeCauseKind;
  summary: string;
  /** Exact income-side dollars from ledger data, signed. 0 for rate-structure causes. */
  incomeDelta: number;
  evidence: Record<string, number | string | boolean>;
}

export interface TaxChangeCause extends TaxChangeFinding {
  /** ESTIMATE: incomeDelta × blended incremental rate (state_move: exact state
   *  delta; filing_status_change: unattributed residual). Never fake-precise. */
  estimatedTaxImpact: number;
}

export interface AccountDrawDelta {
  account: string;
  from: number;
  to: number;
  delta: number;
  priorYearEndingBalance: number;
  depleted: boolean;
}

export interface TaxYearDiff {
  headline: { totalTax: DollarDelta; federalTax: DollarDelta; stateTax: DollarDelta };
  taxLineDeltas: DollarDelta[];
  incomeDeltas: DollarDelta[];
  sourceDeltas: DollarDelta[];
  withdrawalPicture: {
    totalWithdrawals: DollarDelta;
    netCashFlow: DollarDelta;
    byAccount: AccountDrawDelta[];
  };
  marginalFederalRate: { from: number; to: number };
  /** Δtax/ΔtaxableIncome clamped to [0, 0.6]; falls back to year-N marginal
   *  federal rate when taxable income didn't rise. Used for cause estimates. */
  blendedRate: number;
}

export interface TaxChangeExplanation {
  available: true;
  /** True when one year lacks taxResult — headline only, from expenses.taxes. */
  degraded?: boolean;
  year: number;
  compareYear: number;
  headline: { totalTax: DollarDelta; federalTax?: DollarDelta; stateTax?: DollarDelta };
  taxLineDeltas?: DollarDelta[];
  incomeDeltas?: DollarDelta[];
  sourceDeltas?: DollarDelta[];
  causes?: TaxChangeCause[];
  withdrawalPicture?: TaxYearDiff["withdrawalPicture"];
  marginalFederalRate?: { from: number; to: number };
  noSignificantChange?: boolean;
  notes: string[];
}

export interface TaxChangeUnavailable {
  available: false;
  reason: string;
  availableYears?: { first: number; last: number };
}
