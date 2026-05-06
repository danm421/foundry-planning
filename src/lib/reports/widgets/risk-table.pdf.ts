// src/lib/reports/widgets/risk-table.pdf.ts
//
// PDF-side registration glue for the riskTable widget. Imported as a
// side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { RiskTablePdfRender } from "@/components/reports-pdf/widgets/risk-table";

registerWidgetPdf("riskTable", RiskTablePdfRender);
