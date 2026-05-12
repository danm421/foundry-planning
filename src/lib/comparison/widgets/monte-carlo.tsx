import { MonteCarloComparisonSection } from "@/components/comparison/monte-carlo-comparison-section";
import { MonteCarloTableList } from "@/components/comparison/tables/monte-carlo-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const monteCarloWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "monte-carlo",
  title: "Monte Carlo",
  category: "monte-carlo",
  scenarios: "one-or-many",
  needsMc: true,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ mc, config }) => {
    if (!mc) {
      return (
        <section className="px-6 py-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Monte Carlo</h2>
          <div className="h-72 animate-pulse rounded border border-slate-800 bg-slate-900" />
        </section>
      );
    }
    return (
      <ViewModeFrame
        mode={getViewMode(config)}
        chart={<MonteCarloComparisonSection plansMc={mc.perPlan} />}
        table={<MonteCarloTableList mc={mc} />}
      />
    );
  },
};
