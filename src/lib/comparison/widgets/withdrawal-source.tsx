import { WithdrawalSourceComparisonSection } from "@/components/comparison/withdrawal-source-comparison-section";
import { WithdrawalSourceTableList } from "@/components/comparison/tables/withdrawal-source-table";
import {
  ViewModeSchema,
  defaultViewMode,
  getViewMode,
  renderViewModeConfig,
  ViewModeFrame,
  type ViewModeConfig,
} from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const withdrawalSourceWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "withdrawal-source",
  title: "Withdrawal Source",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, yearRange, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<WithdrawalSourceComparisonSection plans={plans} yearRange={yearRange} />}
      table={<WithdrawalSourceTableList plans={plans} yearRange={yearRange} />}
    />
  ),
  hasDataInYear: (_plan, year) =>
    (year.withdrawals?.total ?? 0) > 0 ||
    (year.income?.socialSecurity ?? 0) > 0 ||
    (year.income?.deferred ?? 0) > 0,
};
