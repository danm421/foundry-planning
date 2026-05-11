import { SsIncomeComparisonSection } from "@/components/comparison/ss-income-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const ssIncomeWidget: ComparisonWidgetDefinition = {
  kind: "ss-income",
  title: "Social Security Income",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <SsIncomeComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
