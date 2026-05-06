// src/lib/reports/widgets/expense-detail-table.ts
//
// Screen-side registration glue for the expenseDetailTable widget. Reads
// per-year expense totals from the cashflow scope and renders them as a
// "Year / Annual Expense" branded table.
//
// V1 scope: flat year/expense rows. The `groupByCategory` prop is wired
// in defaults but the screen render keeps things flat — engine
// category-attribution work needed before grouping is possible
// (logged in future-work/reports.md).
//
// PDF renderer attached separately by `expense-detail-table.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { ExpenseDetailTableRender } from "@/components/reports/widgets/expense-detail-table";
import { ExpenseDetailTableInspector } from "@/components/reports/widget-inspectors/expense-detail-table";

registerWidget({
  kind: "expenseDetailTable",
  category: "Data Table",
  label: "Expense Detail Table",
  description: "Year-by-year projected expenses, sourced from cashflow scope.",
  allowedRowSizes: ["1-up", "2-up", "3-up", "4-up"],
  scopes: ["cashflow"],
  defaultProps: {
    title: "Expense Detail",
    yearRange: { from: "default", to: "default" },
    groupByCategory: false,
  },
  Render: ExpenseDetailTableRender,
  Inspector: ExpenseDetailTableInspector,
});
