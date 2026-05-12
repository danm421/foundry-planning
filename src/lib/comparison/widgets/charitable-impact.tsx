import { CharitableImpactComparisonSection } from "@/components/comparison/charitable-impact-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const charitableImpactWidget: ComparisonWidgetDefinition = {
  kind: "charitable-impact",
  title: "Charitable Impact",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <CharitableImpactComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
