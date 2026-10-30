import { z } from "zod";
import { rangeSchema, summarizeRange } from "../../shared/drill-options";
import type { MonthlyCashFlowPageOptions } from "./types";

export const monthlyCashFlowOptionsSchema = z.object({
  view: z.union([z.literal("plan"), z.literal("months")]),
  basis: z.union([z.literal("today"), z.literal("nominal")]),
  range: rangeSchema,
  year: z.number().int().nullable(),
  // Saved decks and firm templates predate the Distributions view; they carry
  // no mode and must keep printing the Cash flow report.
  mode: z.enum(["cashflow", "distributions"]).default("cashflow"),
}) satisfies z.ZodType<MonthlyCashFlowPageOptions, unknown>;

export function summarizeMonthlyCashFlowOptions(o: MonthlyCashFlowPageOptions): string {
  const basis = o.basis === "today" ? "Today's dollars" : "Future dollars";
  if (o.mode === "distributions") return `Distributions · ${o.year ?? "first shortfall year"} · ${basis}`;
  if (o.view === "months") {
    // A null year is resolved at build time against the projection, which the
    // launcher has not run — so it names the rule rather than guessing a year.
    return `Month by month · ${o.year ?? "first shortfall year"} · ${basis}`;
  }
  return `Across the plan · ${summarizeRange(o.range)} · ${basis}`;
}

/** The Distributions card, chart and a full-range table do not share one
 *  sheet; the table wraps to a second. Verified by rendering (task 6 report). */
export function estimateMonthlyCashFlowPageCount(
  _data?: unknown,
  options?: Pick<MonthlyCashFlowPageOptions, "mode">,
): number {
  return options?.mode === "distributions" ? 2 : 1;
}
