import type { EstateSummaryOptions } from "./options-schema";

export function summarizeEstateSummaryOptions(options: EstateSummaryOptions): string {
  return options.ordering === "spouseFirst" ? "Spouse dies first" : "Primary dies first";
}
