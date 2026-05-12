import { TaxBracketFillComparisonSection } from "@/components/comparison/tax-bracket-fill-comparison-section";
import { TaxBracketFillTableList } from "@/components/comparison/tables/tax-bracket-fill-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const taxBracketFillWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "tax-bracket-fill",
  title: "Tax Bracket Fill",
  category: "tax",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, yearRange, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<TaxBracketFillComparisonSection plans={plans} yearRange={yearRange} />}
      table={<TaxBracketFillTableList plans={plans} yearRange={yearRange} />}
    />
  ),
};
