// Options and data shapes for the Monthly Cash Flow deck page — the print form
// of the Solver's Cash Flow → Monthly report.

import type { DollarBasis } from "@/lib/solver/monthly-cash-flow";
import type { RangeOption } from "../../shared/year-filter";
import type { ChartSpec } from "../../charts/types";

export interface MonthlyCashFlowPageOptions {
  /** Which of the report's two tables this sheet prints. The screen has them
   *  behind a toggle; a sheet cannot toggle, so the advisor picks one per page
   *  and adds the page twice to print both. */
  view: "plan" | "months";
  basis: DollarBasis;
  /** Applies to the across-the-plan table only — the month table is one year. */
  range: RangeOption;
  /** The year the month table details. `null` follows the screen's own rule:
   *  the first shortfall year, which is the conversation this report exists for. */
  year: number | null;
}

export const MONTHLY_CASH_FLOW_OPTIONS_DEFAULT: MonthlyCashFlowPageOptions = {
  view: "plan",
  basis: "today",
  range: "full",
  year: null,
};

/** The hero card: the one number an advisor reads out loud, and the arithmetic
 *  behind it. Present on both views — in month view it describes the year the
 *  twelve rows belong to. */
export interface MonthlySummary {
  year: number;
  ageLabel: string;
  income: number;
  fixedTotal: number;
  leftAfterFixed: number;
  portfolioDraw: number;
  available: number;
  living: number;
  surplusSpent: number;
  surplusUnspent: number;
  /** Whatever the named parts could not account for. Shown on its own line,
   *  never folded into another — a leftover that doubles as a dumping ground is
   *  worse than no number. */
  unexplained: number;
  /** The accounts finished the year underwater: `available` is money that does
   *  not exist. */
  depleted: boolean;
}

export interface MonthlyPlanRow {
  year: number;
  /** Numeric, not the screen's "Age 56 / 51" label: this table sits beside the
   *  other Cash Flow sheets in one deck, and they all print "56/51". The prose
   *  label stays on the summary card, where it reads as prose. */
  ageClient: number | null;
  ageSpouse: number | null;
  income: number;
  portfolioDraw: number;
  taxes: number;
  debt: number;
  savings: number;
  other: number;
  available: number;
  depleted: boolean;
}

export interface MonthlyMonthRow {
  label: string;
  income: number;
  portfolioDraw: number;
  taxes: number;
  debt: number;
  savings: number;
  other: number;
  living: number;
  net: number;
  cashOnHand: number;
}

export interface MonthlyCashFlowPageData {
  title: string;
  subtitle: string;
  view: "plan" | "months";
  summary: MonthlySummary | null;
  chartSpec?: ChartSpec;
  /** Populated in "plan" view only. */
  planRows: MonthlyPlanRow[];
  /** Populated in "months" view only. */
  monthRows: MonthlyMonthRow[];
  /** Standing caveats that are load-bearing on screen. Printed under the table
   *  rather than dropped: a reader who takes "Cash on hand" for an account
   *  balance overstates the client's liquid position. */
  notes: string[];
  footnote: string;
}
