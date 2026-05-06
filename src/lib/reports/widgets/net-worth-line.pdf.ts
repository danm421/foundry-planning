// src/lib/reports/widgets/net-worth-line.pdf.ts
//
// PDF-side registration glue for the netWorthLine widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts` (server-only
// barrel, reachable from the export-pdf route via
// `components/reports-pdf/document.tsx`).
//
// Keeping this import out of the screen-side barrel (`./index.ts`) is what
// prevents the `@react-pdf/renderer` runtime from being pulled into the
// client builder bundle.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { NetWorthLinePdfRender } from "@/components/reports-pdf/widgets/net-worth-line";

registerWidgetPdf("netWorthLine", NetWorthLinePdfRender);
