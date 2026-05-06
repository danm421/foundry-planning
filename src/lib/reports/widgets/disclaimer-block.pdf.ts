// src/lib/reports/widgets/disclaimer-block.pdf.ts
//
// PDF-side registration glue for the disclaimerBlock widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { DisclaimerBlockPdfRender } from "@/components/reports-pdf/widgets/disclaimer-block";

registerWidgetPdf("disclaimerBlock", DisclaimerBlockPdfRender);
