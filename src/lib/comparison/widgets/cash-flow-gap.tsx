import { CashFlowGapComparisonSection } from "@/components/comparison/cash-flow-gap-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const cashFlowGapWidget: ComparisonWidgetDefinition = {
  kind: "cash-flow-gap",
  title: "Cash-Flow Gap Years",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <CashFlowGapComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
