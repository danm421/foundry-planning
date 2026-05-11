import { DecadeSummaryComparisonSection } from "@/components/comparison/decade-summary-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const decadeSummaryWidget: ComparisonWidgetDefinition = {
  kind: "decade-summary",
  title: "Decade Summary",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <DecadeSummaryComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
