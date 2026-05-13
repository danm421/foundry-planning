import { ScenarioChangesComparisonSection } from "@/components/comparison/scenario-changes-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const scenarioChangesWidget: ComparisonWidgetDefinition = {
  kind: "scenario-changes",
  title: "Scenario Changes",
  category: "scenario",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans, clientId }) => (
    <ScenarioChangesComparisonSection plans={plans} clientId={clientId} />
  ),
};
