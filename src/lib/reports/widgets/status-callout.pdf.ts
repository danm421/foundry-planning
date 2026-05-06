// src/lib/reports/widgets/status-callout.pdf.ts
//
// PDF-side registration glue for the statusCallout widget.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { StatusCalloutPdfRender } from "@/components/reports-pdf/widgets/status-callout";

registerWidgetPdf("statusCallout", StatusCalloutPdfRender);
