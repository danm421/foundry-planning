import { TaxBracketFillComparisonSection } from "@/components/comparison/tax-bracket-fill-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const taxBracketFillWidget: ComparisonWidgetDefinition = {
  kind: "tax-bracket-fill",
  title: "Tax Bracket Fill",
  category: "tax",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <TaxBracketFillComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
