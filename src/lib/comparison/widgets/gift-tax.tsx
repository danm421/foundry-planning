import { GiftTaxComparisonSection } from "@/components/comparison/gift-tax-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const giftTaxWidget: ComparisonWidgetDefinition = {
  kind: "gift-tax",
  title: "Gift Tax",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <GiftTaxComparisonSection plans={plans} />,
};
