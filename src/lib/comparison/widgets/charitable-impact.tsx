import { CharitableImpactComparisonSection } from "@/components/comparison/charitable-impact-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const charitableImpactWidget: ComparisonWidgetDefinition = {
  kind: "charitable-impact",
  title: "Charitable Impact",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <CharitableImpactComparisonSection plans={plans} yearRange={yearRange} />
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
