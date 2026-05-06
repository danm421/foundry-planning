// src/lib/reports/widgets/recommended-changes-table.pdf.ts
//
// PDF-side registration glue for the recommendedChangesTable widget.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { RecommendedChangesTablePdfRender } from "@/components/reports-pdf/widgets/recommended-changes-table";

registerWidgetPdf("recommendedChangesTable", RecommendedChangesTablePdfRender);
