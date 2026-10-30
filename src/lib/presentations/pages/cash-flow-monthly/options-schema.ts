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

/** Distributions rows that fit one sheet under the table's repeated header
 *  (measured by rendering; see page-count.test.tsx). */
export const DISTRIBUTIONS_ROWS_PER_PAGE = 36;

/** Distributions: card + chart on page 1, the table from page 2 (a forced
 *  break), wrapping on to further sheets only past `DISTRIBUTIONS_ROWS_PER_PAGE`
 *  years. */
export function estimateMonthlyCashFlowPageCount(
  data?: { distribution?: { rows: unknown[] } },
  options?: Pick<MonthlyCashFlowPageOptions, "mode">,
): number {
  if (options?.mode !== "distributions") return 1;
  const rows = data?.distribution?.rows.length ?? 0;
  // A range with no years renders the single "No projection years" sheet.
  if (rows === 0) return 1;
  return 1 + Math.ceil(rows / DISTRIBUTIONS_ROWS_PER_PAGE);
}
