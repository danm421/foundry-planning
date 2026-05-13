import { MajorTransactionsComparisonSection } from "@/components/comparison/major-transactions-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const majorTransactionsWidget: ComparisonWidgetDefinition = {
  kind: "major-transactions",
  title: "Major Transactions",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  hasDataInYear: (_plan, year) => {
    const t = year.techniqueBreakdown;
    return Boolean(t && (t.sales.length > 0 || t.purchases.length > 0));
  },
  render: ({ plans, yearRange }) => (
    <MajorTransactionsComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
