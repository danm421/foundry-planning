import { WithdrawalSourceComparisonSection } from "@/components/comparison/withdrawal-source-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const withdrawalSourceWidget: ComparisonWidgetDefinition = {
  kind: "withdrawal-source",
  title: "Withdrawal Source",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <WithdrawalSourceComparisonSection plans={plans} yearRange={yearRange} />
  ),
  hasDataInYear: (_plan, year) =>
    (year.withdrawals?.total ?? 0) > 0 ||
    (year.income?.socialSecurity ?? 0) > 0 ||
    (year.income?.deferred ?? 0) > 0,
};
