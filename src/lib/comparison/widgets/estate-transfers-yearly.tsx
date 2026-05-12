import { EstateTransfersYearlyComparisonSection } from "@/components/comparison/estate-transfers-yearly-comparison-section";
import {
  ViewModeSchema,
  defaultViewMode,
  getViewMode,
  renderViewModeConfig,
  type ViewModeConfig,
} from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const estateTransfersYearlyWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "estate-transfers-yearly",
  title: "Estate Transfers — Year by Year",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, config }) => (
    <EstateTransfersYearlyComparisonSection plans={plans} mode={getViewMode(config)} />
  ),
};
