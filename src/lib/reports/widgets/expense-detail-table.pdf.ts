// src/lib/reports/widgets/expense-detail-table.pdf.ts
//
// PDF-side registration glue for the expenseDetailTable widget. Imported
// as a side effect from `src/lib/reports/widgets/index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { ExpenseDetailTablePdfRender } from "@/components/reports-pdf/widgets/expense-detail-table";

registerWidgetPdf("expenseDetailTable", ExpenseDetailTablePdfRender);
