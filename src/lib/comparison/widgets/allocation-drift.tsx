import { AllocationDriftComparisonSection } from "@/components/comparison/allocation-drift-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const allocationDriftWidget: ComparisonWidgetDefinition = {
  kind: "allocation-drift",
  title: "Asset Allocation Drift",
  category: "investments",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <AllocationDriftComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
