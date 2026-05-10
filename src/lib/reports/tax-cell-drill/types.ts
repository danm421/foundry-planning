// src/lib/reports/tax-cell-drill/types.ts
import type { Account, ClientData, ProjectionYear } from "@/engine/types";

/** Income Breakdown tab column keys — must match the `key` fields in
 *  `tax-detail-income-table.tsx` exactly. */
export type IncomeColumnKey =
  | "earnedIncome"
  | "taxableSocialSecurity"
  | "ordinaryIncome"
  | "dividends"
  | "capitalGains"
  | "shortCapitalGains"
  | "totalIncome"
  | "nonTaxableIncome"
  | "grossTotalIncome";

/** Tax Bracket tab cell keys — only the three drill-eligible columns. */
export type BracketColumnKey =
  | "conversionGross"
  | "conversionTaxable"
  | "intoBracket";

/** Context shared by all adapters: lookups for source labels. */
export interface CellDrillContext {
  accountNames: Record<string, string>;
  incomes: ClientData["incomes"];
  accounts: Account[];
}

export interface CellDrillRow {
  id: string;
  label: string;
  amount: number;
  meta?: string;
}

export interface CellDrillGroup {
  label?: string;
  rows: CellDrillRow[];
  /** When set, the modal renders a horizontal rule between rows[boundaryIndex - 1]
   *  and rows[boundaryIndex]. Used by the bracket-stacking adapter to mark the
   *  marginal bracket's lower boundary. */
  boundaryIndex?: number;
}

export interface CellDrillProps {
  title: string;
  subtitle?: string;
  total: number;
  groups: CellDrillGroup[];
  footnote?: string;
}

/** Argument tuple for the income-breakdown adapter — exported for use by
 *  the parent state shape. */
export interface IncomeCellDrillArgs {
  year: ProjectionYear;
  columnKey: IncomeColumnKey;
  ctx: CellDrillContext;
}

export interface BracketCellDrillArgs {
  year: ProjectionYear;
  columnKey: BracketColumnKey;
  ctx: CellDrillContext;
}
