import { LiquidityComparisonCharts } from "@/components/comparison/liquidity-comparison-charts";
import { LiquidityTableList } from "@/components/comparison/tables/liquidity-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const liquidityWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "liquidity",
  title: "Liquidity",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={
        <section className="px-6 py-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Liquidity</h2>
          <LiquidityComparisonCharts plans={plans} />
        </section>
      }
      table={<LiquidityTableList plans={plans} />}
    />
  ),
};
