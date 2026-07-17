// src/lib/tax-ledger/types.ts
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";

/** Display tax character for a ledger row. */
export type TaxCharacter =
  | "ordinary"
  | "earned"
  | "qualified_dividends"
  | "long_term_gain"
  | "short_term_gain"
  | "tax_exempt"
  | "social_security"
  | "deduction"
  | "non_taxable";

export type SectionKind = "household" | "business" | "trust" | "charity" | "individual";

export interface TaxLedgerRow {
  /** Short label for the kind of event, e.g. "RMD", "Roth Conversion", "K-1 Pass-Thru Income". */
  type: string;
  /** Human description / source name. */
  description: string;
  character: TaxCharacter;
  /** Resolved source-account name, or null when not account-bound. */
  account: string | null;
  /** Signed: income +, deductions / pass-thru offsets −. */
  amount: number;
  /** False for tax-exempt / deduction / non-taxable rows (drives "hide non-taxable"). */
  taxable: boolean;
}

export interface TaxLedgerSection {
  id: string;
  label: string;
  kind: SectionKind;
  /** True → these events also net up to the household 1040. */
  passThrough: boolean;
  rows: TaxLedgerRow[];
  characterSubtotals: Partial<Record<TaxCharacter, number>>;
  /** Net amount for the section (income rows minus deduction/offset rows). */
  subtotal: number;
  /** Sum of taxable-character income rows — ties to the income-tax report's
   *  "Total Income" column. Household section only. */
  taxableSubtotal?: number;
  /** Sum of all income rows incl. tax-exempt/non-taxable — ties to the
   *  report's "Gross Total Income" column. Household section only. */
  grossSubtotal?: number;
  /** True when an "Unattributed" reconciliation row was added. */
  unreconciled: boolean;
}

export interface TaxLedgerDiagnostics {
  agi: number;
  taxableIncome: number;
  totalFederalTax: number;
  totalStateTax: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  /** $ of ordinary income until the next federal bracket; null at top bracket or when unavailable. */
  bracketHeadroom: number | null;
  niit: { active: boolean; base: number; thresholdDistance: number | null };
  irmaa: { tier: number | null; headroomToNextTier: number | null };
  amt: { bound: boolean; additional: number };
  /** Fraction of SS benefits that is taxable, or null when no SS this year. */
  ssTaxablePercent: number | null;
  taxByType: {
    federalOrdinary: number;
    capitalGains: number;
    niit: number;
    ficaMedicare: number;
    amt: number;
    earlyWithdrawalPenalty: number;
    state: number;
  };
}

export interface TaxLedger {
  year: number;
  sections: TaxLedgerSection[];
  diagnostics: TaxLedgerDiagnostics;
}

/** Name-lookup context. Identical to the cell-drill context — reuse, don't reinvent. */
export type TaxLedgerContext = CellDrillContext;
