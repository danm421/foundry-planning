import { IncomeSourcesComparisonSection } from "@/components/comparison/income-sources-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const incomeSourcesWidget: ComparisonWidgetDefinition = {
  kind: "income-sources",
  title: "Income Sources",
  category: "retirement-income",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <IncomeSourcesComparisonSection plans={plans} />,
};
