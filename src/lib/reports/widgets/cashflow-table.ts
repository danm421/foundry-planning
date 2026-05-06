// src/lib/reports/widgets/cashflow-table.ts
//
// Screen-side registration glue for the cashflowTable widget. Imported
// as a side effect from `src/lib/reports/widgets/index.ts`, which is in
// turn imported by the builder so `registerWidget` runs before the
// reducer's `makeWidget`.
//
// The PDF renderer is attached separately by `cashflow-table.pdf.ts`
// (loaded only by the server-only barrel `index.pdf.ts`) so the
// `@react-pdf/renderer` runtime never reaches the client builder bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { CashflowTableRender } from "@/components/reports/widgets/cashflow-table";
import { CashflowTableInspector } from "@/components/reports/widget-inspectors/cashflow-table";

registerWidget({
  kind: "cashflowTable",
  category: "Data Table",
  label: "Cashflow Table",
  description: "Year-by-year cashflow rows.",
  allowedRowSizes: ["1-up"],
  scopes: ["cashflow"],
  defaultProps: {
    title: "Cashflow detail",
    yearRange: { from: "default", to: "default" },
    ownership: "consolidated",
    showTotals: true,
  },
  Render: CashflowTableRender,
  Inspector: CashflowTableInspector,
});
