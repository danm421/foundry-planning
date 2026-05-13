import { LongevityComparisonSection } from "@/components/comparison/longevity-comparison-section";
import { LongevityTableList } from "@/components/comparison/tables/longevity-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import { McPlaceholder } from "./mc-placeholder";
import type { ComparisonWidgetDefinition } from "./types";

export const longevityWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "longevity",
  title: "Longevity",
  category: "monte-carlo",
  scenarios: "one-or-many",
  needsMc: true,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, mc, mcRun, config }) => {
    if (!mc) {
      return <McPlaceholder title="Longevity" mcRun={mcRun} />;
    }
    const selected = new Set(plans.map((p) => p.id));
    const perPlan = mc.perPlan.filter((p) => selected.has(p.planId));
    return (
      <ViewModeFrame
        mode={getViewMode(config)}
        chart={
          <LongevityComparisonSection
            plans={perPlan.map((p) => ({ label: p.label, matrix: p.result.byYearLiquidAssetsPerTrial }))}
            threshold={mc.threshold}
            planStartYear={mc.planStartYear}
            clientBirthYear={mc.clientBirthYear}
          />
        }
        table={<LongevityTableList mc={{ ...mc, perPlan }} />}
      />
    );
  },
};
