// src/lib/presentations/pages/retirement-comparison/summarize-options.ts
import type { RetirementComparisonOptions } from "./types";

export function summarizeRetirementComparisonOptions(
  opts: RetirementComparisonOptions,
): string {
  // `summarizeOptions` sees ids, never names, so it cannot print the baseline's
  // name — the launcher row's chip does that (Task 6).
  const scenario = !opts.scenarioId
    ? "No scenario selected"
    : opts.baselineScenarioId === "base"
      ? "vs Base Case"
      : "vs a scenario baseline";
  const ai = opts.ai.generatedText ? "AI summary ready" : "AI summary pending";
  return `${scenario} · ${ai}`;
}
