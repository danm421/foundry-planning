import { ImpactVsBasePanel } from "@/components/comparison/impact-vs-base-panel";
import type { ComparisonWidgetDefinition } from "./types";

export const estateImpactWidget: ComparisonWidgetDefinition = {
  kind: "estate-impact",
  title: "Impact vs Base",
  needsMc: false,
  render: ({ plans, collapsed }) => {
    if (collapsed) return null;
    const allHaveFinalEstate = plans.every((p) => p.finalEstate !== null);
    const impactYear = plans.find((p) => p.finalEstate)?.finalEstate?.year ?? null;
    if (!allHaveFinalEstate || impactYear === null) return null;
    return (
      <section className="px-6 py-8">
        <ImpactVsBasePanel year={impactYear} plans={plans} />
      </section>
    );
  },
};
