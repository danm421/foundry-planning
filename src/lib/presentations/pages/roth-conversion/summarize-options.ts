import type { RothConversionPageOptions } from "./types";

// Ids only — the launcher row names the plan itself.
export function summarizeRothConversionOptions(o: RothConversionPageOptions): string {
  return o.scenarioId === "base" ? "Base Case conversions" : "Scenario conversions";
}
