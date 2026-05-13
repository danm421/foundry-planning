import { MonteCarloComparisonSection } from "@/components/comparison/monte-carlo-comparison-section";
import { MonteCarloTableList } from "@/components/comparison/tables/monte-carlo-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import { McPlaceholder } from "./mc-placeholder";
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
  render: ({ plans, mc, mcRun, config }) => {
    if (!mc) {
      return <McPlaceholder title="Monte Carlo" mcRun={mcRun} />;
    }
    const selected = new Set(plans.map((p) => p.id));
    const perPlan = mc.perPlan.filter((p) => selected.has(p.planId));
    return (
      <ViewModeFrame
        mode={getViewMode(config)}
        chart={<MonteCarloComparisonSection plansMc={perPlan} />}
        table={<MonteCarloTableList mc={{ ...mc, perPlan }} />}
      />
    );
  },
};
