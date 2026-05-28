// Shared shape for cash-flow drill-down pages (Income, Expenses, Savings,
// Net Cash Flow, Portfolio Growth/Activity/Assets). Each drill page builds a
// DrillPageData; renderPdf delegates to DrillPagePdf.

import type { ChartSpec } from "../charts/types";
import type { CashFlowPageOptions, TableMarker } from "../types";

// Drill pages reuse the same options shape as the parent cash-flow page so
// the year-range UI and serialization behaves identically.
export type DrillPageOptions = CashFlowPageOptions;

export interface DrillColumn {
  key: string;        // matches DrillRow.cells key
  header: string;     // single line, or two lines split by "\n"
  width: number;      // points. Only honored on the last column (right-pinned).
                      // Middle columns share remaining space equally via flex.
  strong?: boolean;   // bolds the header + cells (totals)
  signColor?: boolean; // green/red on +/- (Net Cash Flow style)
  format?: "currency" | "percent"; // default = currency. percent expects 0..1 fractions.
}

export interface DrillRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  cells: Record<string, number>;
}

export interface DrillPageData {
  title: string;     // e.g. "Income"
  subtitle: string;  // scenario label
  callout?: string;
  // Omit chartSpec for drills the in-app report has no chart for (Portfolio
  // Growth, Portfolio Activity). DrillPagePdf falls back to a table-only
  // layout in that case.
  chartSpec?: ChartSpec;
  table: {
    columns: DrillColumn[];
    rows: DrillRow[];
    markers: TableMarker[];
  };
  footnote: string;
}
