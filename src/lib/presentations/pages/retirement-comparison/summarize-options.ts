// src/lib/presentations/pages/retirement-comparison/summarize-options.ts
import type { RetirementComparisonOptions } from "./types";

export function summarizeRetirementComparisonOptions(
  opts: RetirementComparisonOptions,
): string {
  const scenario = opts.scenarioId ? "vs Base Case" : "No scenario selected";
  const ai = opts.ai.generatedText ? "AI summary ready" : "AI summary pending";
  return `${scenario} · ${ai}`;
}
