import { WithdrawalSourceComparisonSection } from "@/components/comparison/withdrawal-source-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const withdrawalSourceWidget: ComparisonWidgetDefinition = {
  kind: "withdrawal-source",
  title: "Withdrawal Source",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <WithdrawalSourceComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
