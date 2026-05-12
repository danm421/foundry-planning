import { RothLadderComparisonSection } from "@/components/comparison/roth-ladder-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const rothLadderWidget: ComparisonWidgetDefinition = {
  kind: "roth-ladder",
  title: "Roth Conversion Ladder",
  category: "tax",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <RothLadderComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
