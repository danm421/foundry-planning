import { RmdScheduleComparisonSection } from "@/components/comparison/rmd-schedule-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const rmdScheduleWidget: ComparisonWidgetDefinition = {
  kind: "rmd-schedule",
  title: "RMD Schedule",
  category: "retirement-income",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <RmdScheduleComparisonSection plans={plans} yearRange={yearRange} />
  ),
  hasDataInYear: (_plan, year) => {
    for (const led of Object.values(year.accountLedgers ?? {})) {
      if ((led.rmdAmount ?? 0) > 0) return true;
    }
    return false;
  },
};
