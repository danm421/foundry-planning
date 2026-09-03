import { z } from "zod";
import { rangeSchema, summarizeRange } from "../../shared/drill-options";
import type { MonthlyCashFlowPageOptions } from "./types";

export const monthlyCashFlowOptionsSchema = z.object({
  view: z.union([z.literal("plan"), z.literal("months")]),
  basis: z.union([z.literal("today"), z.literal("nominal")]),
  range: rangeSchema,
  year: z.number().int().nullable(),
}) satisfies z.ZodType<MonthlyCashFlowPageOptions>;

export function summarizeMonthlyCashFlowOptions(o: MonthlyCashFlowPageOptions): string {
  const basis = o.basis === "today" ? "Today's dollars" : "Future dollars";
  if (o.view === "months") {
    // A null year is resolved at build time against the projection, which the
    // launcher has not run — so it names the rule rather than guessing a year.
    return `Month by month · ${o.year ?? "first shortfall year"} · ${basis}`;
  }
  return `Across the plan · ${summarizeRange(o.range)} · ${basis}`;
}

export function estimateMonthlyCashFlowPageCount(): number {
  return 1;
}
