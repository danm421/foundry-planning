import type { EstateSummaryOptions } from "./options-schema";

export function summarizeEstateSummaryOptions(options: EstateSummaryOptions): string {
  return options.ordering === "spouseFirst" ? "Co-client dies first" : "Primary dies first";
}
