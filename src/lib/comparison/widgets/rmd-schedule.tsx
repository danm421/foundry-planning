import { RmdScheduleComparisonSection } from "@/components/comparison/rmd-schedule-comparison-section";
import { RmdScheduleTableList } from "@/components/comparison/tables/rmd-schedule-table";
import {
  ViewModeSchema,
  defaultViewMode,
  getViewMode,
  renderViewModeConfig,
  ViewModeFrame,
  type ViewModeConfig,
} from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const rmdScheduleWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "rmd-schedule",
  title: "RMD Schedule",
  category: "retirement-income",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, yearRange, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<RmdScheduleComparisonSection plans={plans} yearRange={yearRange} />}
      table={<RmdScheduleTableList plans={plans} yearRange={yearRange} />}
    />
  ),
  hasDataInYear: (_plan, year) => {
    for (const led of Object.values(year.accountLedgers ?? {})) {
      if ((led.rmdAmount ?? 0) > 0) return true;
    }
    return false;
  },
};
