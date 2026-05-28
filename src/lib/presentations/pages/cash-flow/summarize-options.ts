import type { CashFlowPageOptions } from "@/lib/presentations/types";

export function summarizeCashFlowOptions(opts: CashFlowPageOptions): string {
  if (opts.range === "retirement") return "Retirement only";
  if (opts.range === "lifetime") return "Lifetime";
  return `${opts.range.startYear}–${opts.range.endYear}`; // en-dash U+2013
}
