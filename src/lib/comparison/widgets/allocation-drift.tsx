import { AllocationDriftComparisonSection } from "@/components/comparison/allocation-drift-comparison-section";
import { AllocationDriftTableList } from "@/components/comparison/tables/allocation-drift-table";
import { ViewModeSchema, defaultViewMode, getViewMode, renderViewModeConfig, ViewModeFrame, type ViewModeConfig } from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const allocationDriftWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "allocation-drift",
  title: "Asset Allocation Drift",
  category: "investments",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: (ctx) => {
    // Single-year mode has no meaningful table — show but disabled.
    // Caller (modal) doesn't yet know yearRange; leave runtime selector and
    // let the renderer interpret table/chart correctly.
    return renderViewModeConfig(ctx);
  },
  defaultYearRange: ({ plans }) => {
    const planStart = plans[0]?.result.years[0]?.year;
    if (planStart == null) return undefined;
    return { start: planStart, end: planStart };
  },
  render: ({ plans, yearRange, config }) => {
    const isSingleYear = yearRange != null && yearRange.start === yearRange.end;
    const mode = isSingleYear ? "chart" : getViewMode(config);
    return (
      <ViewModeFrame
        mode={mode}
        chart={<AllocationDriftComparisonSection plans={plans} yearRange={yearRange} />}
        table={<AllocationDriftTableList plans={plans} yearRange={yearRange} />}
      />
    );
  },
};
