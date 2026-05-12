import { CashFlowGapComparisonSection } from "@/components/comparison/cash-flow-gap-comparison-section";
import { CashFlowGapTableList } from "@/components/comparison/tables/cash-flow-gap-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const cashFlowGapWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "cash-flow-gap",
  title: "Cash-Flow Gap Years",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, yearRange, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<CashFlowGapComparisonSection plans={plans} yearRange={yearRange} />}
      table={<CashFlowGapTableList plans={plans} yearRange={yearRange} />}
    />
  ),
};
