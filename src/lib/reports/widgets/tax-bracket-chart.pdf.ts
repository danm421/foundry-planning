// src/lib/reports/widgets/tax-bracket-chart.pdf.ts
//
// PDF-side registration glue for the taxBracketChart widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { TaxBracketChartPdfRender } from "@/components/reports-pdf/widgets/tax-bracket-chart";

registerWidgetPdf("taxBracketChart", TaxBracketChartPdfRender);
