// src/lib/reports/widgets/policies-table.pdf.ts
//
// PDF-side registration glue for the policiesTable widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { PoliciesTablePdfRender } from "@/components/reports-pdf/widgets/policies-table";

registerWidgetPdf("policiesTable", PoliciesTablePdfRender);
