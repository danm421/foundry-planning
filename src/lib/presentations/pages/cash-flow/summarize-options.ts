// src/lib/presentations/pages/cash-flow/summarize-options.ts
import type { CashFlowPageOptions } from "@/lib/presentations/types";

export function summarizeCashFlowOptions(opts: CashFlowPageOptions): string {
  if (opts.range === "full") return "Full range";
  return `${opts.range.startYear}–${opts.range.endYear}`; // en-dash U+2013
}
