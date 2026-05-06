// src/lib/reports/widgets/balance-sheet-table.pdf.ts
//
// PDF-side registration glue for the balanceSheetTable widget. Imported as
// a side effect from `src/lib/reports/widgets/index.pdf.ts` (server-only
// barrel, reachable from the export-pdf route via
// `components/reports-pdf/document.tsx`).

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { BalanceSheetTablePdfRender } from "@/components/reports-pdf/widgets/balance-sheet-table";

registerWidgetPdf("balanceSheetTable", BalanceSheetTablePdfRender);
