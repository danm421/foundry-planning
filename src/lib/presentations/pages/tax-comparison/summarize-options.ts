import type { TaxComparisonOptions } from "./options-schema";

export function summarizeTaxComparisonOptions(options: TaxComparisonOptions): string {
  const scn = options.scenarioId ? "vs scenario" : "No scenario";
  return `${scn} · Low <${Math.round(options.lowThreshold * 100)}% · High >${Math.round(options.highThreshold * 100)}%`;
}
