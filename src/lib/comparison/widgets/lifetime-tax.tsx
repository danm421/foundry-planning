import { LifetimeTaxComparisonSection } from "@/components/comparison/lifetime-tax-comparison-section";
import { LifetimeTaxTableList } from "@/components/comparison/tables/lifetime-tax-table";
import {
  ViewModeSchema,
  defaultViewMode,
  getViewMode,
  renderViewModeConfig,
  ViewModeFrame,
  type ViewModeConfig,
} from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const lifetimeTaxWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "lifetime-tax",
  title: "Lifetime Tax",
  category: "tax",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<LifetimeTaxComparisonSection plans={plans} />}
      table={<LifetimeTaxTableList plans={plans} />}
    />
  ),
};
