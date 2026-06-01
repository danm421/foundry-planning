import type { ScenarioChangesOptions } from "./types";

export function summarizeScenarioChangesOptions(opts: ScenarioChangesOptions): string {
  return opts.showExplanations ? "With explanations" : "Changes only";
}
