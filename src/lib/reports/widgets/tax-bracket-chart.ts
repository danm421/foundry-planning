// src/lib/reports/widgets/tax-bracket-chart.ts
//
// Screen-side registration glue for the taxBracketChart widget. Stacked
// bars per year showing income filling 2026 single-filer tax brackets
// (10/12/22/24/32/35/37%). Reads year-by-year income totals from the
// cashflow scope.
//
// V1 limitations:
// - Single-filer brackets only, hard-coded inline. Filing-status-aware
//   brackets (MFJ/MFS/HoH) and inflation-adjusted future-year brackets
//   require engine plumbing — logged in future-work/reports.md.
// - The `showRothBands` toggle is a no-op in v1; overlaying Roth
//   conversion bands needs Roth-conversion data plumbed through the
//   cashflow scope (also future-work).
//
// PDF renderer attached separately by `tax-bracket-chart.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { TaxBracketChartRender } from "@/components/reports/widgets/tax-bracket-chart";
import { TaxBracketChartInspector } from "@/components/reports/widget-inspectors/tax-bracket-chart";

registerWidget({
  kind: "taxBracketChart",
  category: "Chart",
  label: "Tax Bracket Chart",
  description:
    "Stacked bars per year showing income filling federal tax brackets.",
  allowedRowSizes: ["1-up", "2-up"],
  scopes: ["cashflow"],
  defaultProps: {
    title: "Tax Bracket Visualization",
    yearRange: { from: "default", to: "default" },
    showRothBands: false,
  },
  Render: TaxBracketChartRender,
  Inspector: TaxBracketChartInspector,
});
