import { SsIncomeComparisonSection } from "@/components/comparison/ss-income-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const ssIncomeWidget: ComparisonWidgetDefinition = {
  kind: "ss-income",
  title: "Social Security Income",
  category: "retirement-income",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <SsIncomeComparisonSection plans={plans} yearRange={yearRange} />
  ),
  hasDataInYear: (_plan, year) => (year.income?.socialSecurity ?? 0) > 0,
};
