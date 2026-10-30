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

/** Distributions table rows per sheet. The page breaks after exactly this many
 *  (page-pdf.tsx), so a sheet's height never decides the count; that the
 *  last, fullest sheet — head, a three-line header, 36 rows, both notes and
 *  the footnote — clears the footer is measured in page-count.test.tsx. */
export const DISTRIBUTIONS_ROWS_PER_PAGE = 36;

/** Distributions: card + chart on page 1 (the chart on a sheet of its own when
 *  the card leaves too little room), then one sheet per
 *  `DISTRIBUTIONS_ROWS_PER_PAGE` table rows — the same sheets page-pdf.tsx
 *  renders. */
export function estimateMonthlyCashFlowPageCount(
  data?: { distribution?: { rows: unknown[]; chartOnOwnSheet: boolean } },
  options?: Pick<MonthlyCashFlowPageOptions, "mode">,
): number {
  if (options?.mode !== "distributions") return 1;
  const rows = data?.distribution?.rows.length ?? 0;
  // A range with no years renders the single "No projection years" sheet.
  if (rows === 0) return 1;
  const chartSheet = data?.distribution?.chartOnOwnSheet ? 1 : 0;
  return 1 + chartSheet + Math.ceil(rows / DISTRIBUTIONS_ROWS_PER_PAGE);
}
