import type { RetirementSummaryOptions } from "./options-schema";
import { fmtPct } from "./aggregate";

export function summarizeRetirementSummaryOptions(options: RetirementSummaryOptions): string {
  // `?.`: a saved template reaches the launcher row unparsed and may predate the setting.
  const ms = options.maxSpend;
  return ms?.show
    ? `Lifetime funding · SS 62–70 · Max spend at ${fmtPct(ms.targetConfidence)}`
    : "Lifetime funding · SS 62–70";
}
