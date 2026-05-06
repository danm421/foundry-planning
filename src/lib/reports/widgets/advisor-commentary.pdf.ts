// src/lib/reports/widgets/advisor-commentary.pdf.ts
//
// PDF-side registration glue for the advisorCommentary widget.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { AdvisorCommentaryPdfRender } from "@/components/reports-pdf/widgets/advisor-commentary";

registerWidgetPdf("advisorCommentary", AdvisorCommentaryPdfRender);
