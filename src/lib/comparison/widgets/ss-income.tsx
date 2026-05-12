import { SsIncomeComparisonSection } from "@/components/comparison/ss-income-comparison-section";
import { SsIncomeTableList } from "@/components/comparison/tables/ss-income-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const ssIncomeWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "ss-income",
  title: "Social Security Income",
  category: "retirement-income",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, yearRange, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<SsIncomeComparisonSection plans={plans} yearRange={yearRange} />}
      table={<SsIncomeTableList plans={plans} yearRange={yearRange} />}
    />
  ),
  hasDataInYear: (_plan, year) => (year.income?.socialSecurity ?? 0) > 0,
};
