import { LifetimeTaxComparisonSection } from "@/components/comparison/lifetime-tax-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const lifetimeTaxWidget: ComparisonWidgetDefinition = {
  kind: "lifetime-tax",
  title: "Lifetime Tax",
  category: "tax",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <LifetimeTaxComparisonSection plans={plans} />,
};
