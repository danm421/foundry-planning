import type { ScenarioComparisonOptions } from "./types";

/** The launcher row's summary. It receives ids and never names, so it counts
 *  rather than naming — the Options dialog is where the scenarios are read. */
export function summarizeScenarioComparisonOptions(o: ScenarioComparisonOptions): string {
  const n = o.scenarioIds.filter(Boolean).length;
  const picked = n === 0 ? "No scenarios selected" : `${n} scenario${n === 1 ? "" : "s"}`;
  const spend = o.maxSpend.show
    ? ` · max spend at ${Math.round(o.maxSpend.targetConfidence * 100)}%`
    : "";
  return `${picked}${spend}`;
}
