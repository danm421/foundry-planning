// src/lib/reports/widgets/kpi-tile.pdf.ts
//
// PDF-side registration glue for the kpiTile widget. Imported as a side
// effect from `src/lib/reports/widgets/index.pdf.ts` (server-only barrel,
// reachable from the export-pdf route via `components/reports-pdf/document.tsx`).
//
// Keeping this import out of the screen-side barrel (`./index.ts`) is what
// prevents the @react-pdf/renderer runtime from being pulled into the client
// builder bundle.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { KpiTilePdfRender } from "@/components/reports-pdf/widgets/kpi-tile";

registerWidgetPdf("kpiTile", KpiTilePdfRender);
