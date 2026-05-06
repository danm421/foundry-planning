// src/lib/reports/widgets/income-sources-area.ts
//
// Screen-side registration glue for the incomeSourcesArea widget.
// Imported as a side effect from `src/lib/reports/widgets/index.ts`,
// which is in turn imported by the builder so `registerWidget` runs
// before the reducer's `makeWidget`.
//
// The PDF renderer is attached separately by `income-sources-area.pdf.ts`
// (loaded only by the server-only barrel `index.pdf.ts`) so the
// `@react-pdf/renderer` runtime never reaches the client builder bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { IncomeSourcesAreaRender } from "@/components/reports/widgets/income-sources-area";
import { IncomeSourcesAreaInspector } from "@/components/reports/widget-inspectors/income-sources-area";

registerWidget({
  kind: "incomeSourcesArea",
  category: "Chart",
  label: "Income Sources",
  description: "Stacked area of income source mix through retirement.",
  allowedRowSizes: ["1-up"],
  scopes: ["cashflow"],
  defaultProps: {
    title: "Income through retirement",
    yearRange: { from: "default", to: "default" },
    series: ["wages", "socialSecurity", "withdrawals", "pensions", "other"],
  },
  Render: IncomeSourcesAreaRender,
  Inspector: IncomeSourcesAreaInspector,
});
