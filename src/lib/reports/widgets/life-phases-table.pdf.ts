// src/lib/reports/widgets/life-phases-table.pdf.ts
//
// PDF-side registration glue for the lifePhasesTable widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { LifePhasesTablePdfRender } from "@/components/reports-pdf/widgets/life-phases-table";

registerWidgetPdf("lifePhasesTable", LifePhasesTablePdfRender);
