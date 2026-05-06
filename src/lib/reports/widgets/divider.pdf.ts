// src/lib/reports/widgets/divider.pdf.ts
//
// PDF-side registration glue for the divider widget.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { DividerPdfRender } from "@/components/reports-pdf/widgets/divider";

registerWidgetPdf("divider", DividerPdfRender);
