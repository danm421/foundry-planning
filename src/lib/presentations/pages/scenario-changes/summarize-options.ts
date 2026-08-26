import type { ScenarioChangesOptions } from "./types";

export function summarizeScenarioChangesOptions(opts: ScenarioChangesOptions): string {
  const scenario = opts.scenarioId ? "vs Base Case" : "No scenario selected";
  return `${scenario} · ${opts.showExplanations ? "With details" : "Changes only"}`;
}
