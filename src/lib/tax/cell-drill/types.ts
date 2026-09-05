import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import type { FilingStatus } from "@/lib/tax/types";

export type { CellDrillRow, CellDrillGroup, CellDrillProps } from "@/lib/cell-drill/types";

/** Income Breakdown tab column keys — must match the `key` fields in
 *  `tax-detail-income-table.tsx` exactly. */
export type IncomeColumnKey =
  | "earnedIncome"
  | "taxableSocialSecurity"
  | "ordinaryIncome"
  | "dividends"
  | "capitalGains"
  | "shortCapitalGains"
  | "qbi"
  | "taxAdjustments"
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
  /** Optional entity-id → display-name map for `entity_passthrough:<id>` keys. */
  entityNames?: Record<string, string>;
  /** Optional roth-conversion-id → display-name map for `roth_conversion:<id>` keys. */
  rothConversionNames?: Record<string, string>;
  /** Optional note-receivable-id → display-name map for `note:<id>:<kind>` keys. */
  noteNames?: Record<string, string>;
  /** Optional equity-plan accountId → display-name map for `equity-vest:<id>`,
   *  `equity-ltcg:<id>`, and `equity-stcg:<id>` keys. */
  equityPlanNames?: Record<string, string>;
  /** Optional tax-adjustment-id → display-name map for `tax_adjustment:<id>`
   *  keys. Advisors name these ("2026 Roth conversion, already done"), and an
   *  unnamed row is the whole reason the Tax Adjustments drill-down read as a
   *  wall of identical "Tax Adjustment" lines. */
  taxAdjustmentNames?: Record<string, string>;
  /** Optional filing status — used by the capital-loss drill-down rows to pick
   *  the correct §1211(b) annual ordinary-income-offset limit ($3,000, or
   *  $1,500 for married_separate). Not populated by every caller. */
  filingStatus?: FilingStatus;
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
