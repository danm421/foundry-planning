// src/lib/reports/widgets/action-items-list.pdf.ts
//
// PDF-side registration glue for the actionItemsList widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { ActionItemsListPdfRender } from "@/components/reports-pdf/widgets/action-items-list";

registerWidgetPdf("actionItemsList", ActionItemsListPdfRender);
