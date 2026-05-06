// src/lib/reports/widgets/balance-sheet-table.ts
//
// Screen-side registration glue for the balanceSheetTable widget. Imported
// as a side effect from `src/lib/reports/widgets/index.ts`.
//
// `scopes: []` — this widget does NOT use the scope registry; instead the
// data-loader's `balanceSheetTable` branch reads `ctx.accounts/liabilities/
// entities` and runs them through the existing `buildViewModel`. The export
// route bridges engine `owners[]` → legacy `{ owner, ownerEntityId }` shape
// before passing them in.
//
// PDF renderer attached separately by `balance-sheet-table.pdf.ts` (loaded
// only by the server-only `index.pdf.ts` barrel) so the
// `@react-pdf/renderer` runtime never reaches the client builder bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { BalanceSheetTableRender } from "@/components/reports/widgets/balance-sheet-table";
import { BalanceSheetTableInspector } from "@/components/reports/widget-inspectors/balance-sheet-table";

registerWidget({
  kind: "balanceSheetTable",
  category: "Data Table",
  label: "Balance Sheet",
  description: "Assets, liabilities, and net worth at a selected year.",
  allowedRowSizes: ["1-up", "2-up"],
  scopes: [],
  defaultProps: {
    title: "Balance sheet",
    asOfYear: "current",
    ownership: "consolidated",
    showEntityBreakdown: false,
  },
  Render: BalanceSheetTableRender,
  Inspector: BalanceSheetTableInspector,
});
