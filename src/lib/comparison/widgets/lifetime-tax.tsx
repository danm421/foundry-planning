import { LifetimeTaxComparisonSection } from "@/components/comparison/lifetime-tax-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const lifetimeTaxWidget: ComparisonWidgetDefinition = {
  kind: "lifetime-tax",
  title: "Lifetime Tax",
  needsMc: false,
  render: ({ plans, collapsed }) =>
    collapsed ? null : <LifetimeTaxComparisonSection plans={plans} />,
};
