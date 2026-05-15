import { EstateDistributionFormComparisonSection } from "@/components/comparison/estate-distribution-form-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const estateDistributionFormWidget: ComparisonWidgetDefinition = {
  kind: "estate-distribution-form",
  title: "Beneficiary Distribution: Outright vs In-Trust",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <EstateDistributionFormComparisonSection plans={plans} />,
};
