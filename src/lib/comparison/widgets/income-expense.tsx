import { IncomeExpenseComparisonSection } from "@/components/comparison/income-expense-comparison-section";
import { IncomeExpenseTableList } from "@/components/comparison/tables/income-expense-table";
import {
  ViewModeSchema,
  defaultViewMode,
  getViewMode,
  renderViewModeConfig,
  ViewModeFrame,
  type ViewModeConfig,
} from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const incomeExpenseWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "income-expense",
  title: "Cash Flow Bar Chart",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, yearRange, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<IncomeExpenseComparisonSection plans={plans} yearRange={yearRange} />}
      table={<IncomeExpenseTableList plans={plans} yearRange={yearRange} />}
    />
  ),
};
