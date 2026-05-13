import { BalanceSheetComparisonSection } from "@/components/comparison/balance-sheet-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const balanceSheetWidget: ComparisonWidgetDefinition = {
  kind: "balance-sheet",
  title: "Balance Sheet",
  category: "investments",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <BalanceSheetComparisonSection plans={plans} />,
};
