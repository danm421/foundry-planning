import { LongevityComparisonSection } from "@/components/comparison/longevity-comparison-section";
import { LongevityTableList } from "@/components/comparison/tables/longevity-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
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
  render: ({ mc, config }) => {
    if (!mc) {
      return (
        <section className="px-6 py-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Longevity</h2>
          <div className="h-72 animate-pulse rounded border border-slate-800 bg-slate-900" />
        </section>
      );
    }
    return (
      <ViewModeFrame
        mode={getViewMode(config)}
        chart={
          <LongevityComparisonSection
            plans={mc.perPlan.map((p) => ({ label: p.label, matrix: p.result.byYearLiquidAssetsPerTrial }))}
            threshold={mc.threshold}
            planStartYear={mc.planStartYear}
            clientBirthYear={mc.clientBirthYear}
          />
        }
        table={<LongevityTableList mc={mc} />}
      />
    );
  },
};
