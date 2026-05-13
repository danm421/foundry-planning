import { ExpenseDetailComparisonSection } from "@/components/comparison/expense-detail-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const expenseDetailWidget: ComparisonWidgetDefinition = {
  kind: "expense-detail",
  title: "Expense Detail",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <ExpenseDetailComparisonSection plans={plans} />,
};
