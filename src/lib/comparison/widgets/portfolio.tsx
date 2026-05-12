import { PortfolioComparisonSection } from "@/components/comparison/portfolio-comparison-section";
import { PortfolioTableList } from "@/components/comparison/tables/portfolio-table";
import {
  ViewModeSchema,
  defaultViewMode,
  getViewMode,
  renderViewModeConfig,
  ViewModeFrame,
  type ViewModeConfig,
} from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const portfolioWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "portfolio",
  title: "Portfolio Assets",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<PortfolioComparisonSection plans={plans} />}
      table={<PortfolioTableList plans={plans} />}
    />
  ),
};
