// src/lib/reports/widgets/cashflow-bar-chart.pdf.ts
//
// PDF-side registration glue for the cashflowBarChart widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts` (server-only
// barrel, reachable from the export-pdf route via
// `components/reports-pdf/document.tsx`).
//
// Keeping this import out of the screen-side barrel (`./index.ts`) is what
// prevents the `@react-pdf/renderer` runtime from being pulled into the
// client builder bundle.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { CashflowBarChartPdfRender } from "@/components/reports-pdf/widgets/cashflow-bar-chart";

registerWidgetPdf("cashflowBarChart", CashflowBarChartPdfRender);
