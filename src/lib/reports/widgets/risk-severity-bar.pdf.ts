// src/lib/reports/widgets/risk-severity-bar.pdf.ts
//
// PDF-side registration glue for the riskSeverityBar widget. Imported
// as a side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { RiskSeverityBarPdfRender } from "@/components/reports-pdf/widgets/risk-severity-bar";

registerWidgetPdf("riskSeverityBar", RiskSeverityBarPdfRender);
