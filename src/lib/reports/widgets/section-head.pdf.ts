// src/lib/reports/widgets/section-head.pdf.ts
//
// PDF-side registration glue for the sectionHead widget. Imported from
// `src/lib/reports/widgets/index.pdf.ts` (server-only barrel). Keeping
// this off the screen barrel is what keeps @react-pdf/renderer out of
// the client bundle.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { SectionHeadPdfRender } from "@/components/reports-pdf/widgets/section-head";

registerWidgetPdf("sectionHead", SectionHeadPdfRender);
