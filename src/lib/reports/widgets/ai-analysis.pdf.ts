// src/lib/reports/widgets/ai-analysis.pdf.ts
//
// PDF-side registration glue for the aiAnalysis widget.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { AiAnalysisPdfRender } from "@/components/reports-pdf/widgets/ai-analysis";

registerWidgetPdf("aiAnalysis", AiAnalysisPdfRender);
