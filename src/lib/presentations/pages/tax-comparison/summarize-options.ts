import type { TaxComparisonOptions } from "./options-schema";

export function summarizeTaxComparisonOptions(options: TaxComparisonOptions): string {
  const scn = !options.scenarioId
    ? "No scenario"
    : options.baselineScenarioId === "base"
      ? "vs scenario"
      : "vs a scenario baseline";
  return `${scn} · Low <${Math.round(options.lowThreshold * 100)}% · High >${Math.round(options.highThreshold * 100)}%`;
}
