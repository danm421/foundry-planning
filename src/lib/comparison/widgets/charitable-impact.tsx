import { CharitableImpactComparisonSection } from "@/components/comparison/charitable-impact-comparison-section";
import { CharitableImpactTableList } from "@/components/comparison/tables/charitable-impact-table";
import {
  ViewModeSchema,
  defaultViewMode,
  getViewMode,
  renderViewModeConfig,
  ViewModeFrame,
  type ViewModeConfig,
} from "./view-mode";
import type { ComparisonWidgetDefinition } from "./types";

export const charitableImpactWidget: ComparisonWidgetDefinition<ViewModeConfig> = {
  kind: "charitable-impact",
  title: "Charitable Impact",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  configSchema: ViewModeSchema,
  defaultConfig: defaultViewMode,
  renderConfig: renderViewModeConfig,
  render: ({ plans, yearRange, config }) => (
    <ViewModeFrame
      mode={getViewMode(config)}
      chart={<CharitableImpactComparisonSection plans={plans} yearRange={yearRange} />}
      table={<CharitableImpactTableList plans={plans} yearRange={yearRange} />}
    />
  ),
  hasDataInYear: (plan, year) => {
    if ((year.charitableOutflows ?? 0) > 0) return true;
    const charityIds = new Set(
      (plan.tree.externalBeneficiaries ?? [])
        .filter((eb) => eb.kind === "charity")
        .map((eb) => eb.id),
    );
    for (const g of plan.tree.gifts ?? []) {
      if (g.year !== year.year) continue;
      if (!g.recipientExternalBeneficiaryId) continue;
      if (charityIds.has(g.recipientExternalBeneficiaryId) && g.amount > 0) {
        return true;
      }
    }
    return false;
  },
};
