import type { TaxSummaryOptions } from "./options-schema";

export function summarizeTaxSummaryOptions(options: TaxSummaryOptions): string {
  return `Low <${Math.round(options.lowThreshold * 100)}% · High >${Math.round(options.highThreshold * 100)}%`;
}
