import { DecadeSummaryComparisonSection } from "@/components/comparison/decade-summary-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const decadeSummaryWidget: ComparisonWidgetDefinition = {
  kind: "decade-summary",
  title: "Decade Summary",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <DecadeSummaryComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
