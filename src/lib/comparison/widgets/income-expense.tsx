import { IncomeExpenseComparisonSection } from "@/components/comparison/income-expense-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const incomeExpenseWidget: ComparisonWidgetDefinition = {
  kind: "income-expense",
  title: "Income & Expenses over time",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <IncomeExpenseComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
