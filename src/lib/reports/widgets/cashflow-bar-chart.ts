// src/lib/reports/widgets/cashflow-bar-chart.ts
//
// Screen-side registration glue for the cashflowBarChart widget. Imported
// as a side effect from `src/lib/reports/widgets/index.ts`, which is in
// turn imported by the builder so `registerWidget` runs before the
// reducer's `makeWidget`.
//
// The PDF renderer is attached separately by `cashflow-bar-chart.pdf.ts`
// (loaded only by the server-only barrel `index.pdf.ts`) so the
// `@react-pdf/renderer` runtime never reaches the client builder bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { CashflowBarChartRender } from "@/components/reports/widgets/cashflow-bar-chart";
import { CashflowBarChartInspector } from "@/components/reports/widget-inspectors/cashflow-bar-chart";

registerWidget({
  kind: "cashflowBarChart",
  category: "Chart",
  label: "Cashflow Bar Chart",
  description: "Stacked annual income vs spending.",
  allowedRowSizes: ["1-up"],
  scopes: ["cashflow"],
  defaultProps: {
    title: "Cashflow",
    yearRange: { from: "default", to: "default" },
    ownership: "consolidated",
    stacking: "stacked",
    showLegend: true,
    showGrid: true,
  },
  Render: CashflowBarChartRender,
  Inspector: CashflowBarChartInspector,
});
