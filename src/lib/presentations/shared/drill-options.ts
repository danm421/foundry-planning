// Shared options helpers for every cash-flow drill-down page. Each drill page
// references these from its registry entry so behavior stays uniform.

import { z } from "zod";
import type { DrillPageData, DrillPageOptions } from "./drill-types";
import type { RangeOption } from "./year-filter";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "../types";
import { PAGE_PAD_X, PAGE_WIDTH_PORTRAIT } from "@/components/presentations/shared/page-frame";

const customRange = z
  .object({
    startYear: z.number().int(),
    endYear: z.number().int(),
  })
  .refine((r) => r.endYear >= r.startYear, {
    message: "endYear must be >= startYear",
  });

// "full" = entire projection. Legacy templates persisted "retirement"/"lifetime";
// coerce those to "full" before validation so old decks load unchanged.
export const rangeSchema = z.preprocess(
  (v) => (v === "retirement" || v === "lifetime" ? "full" : v),
  z.union([z.literal("full"), z.literal("rothConversionYears"), customRange]),
);

/** One label per range, shared by every page that persists one. */
export function summarizeRange(range: RangeOption): string {
  if (range === "full") return "Full range";
  if (range === "rothConversionYears") return "Roth conversion years";
  return `${range.startYear}–${range.endYear}`; // en-dash U+2013
}

export const drillOptionsSchema = z.object({
  range: rangeSchema,
  showCallout: z.boolean(),
  calloutText: z.string().optional(),
}) satisfies z.ZodType<DrillPageOptions>;

export const DRILL_PAGE_OPTIONS_DEFAULT: DrillPageOptions =
  CASH_FLOW_PAGE_OPTIONS_DEFAULT;

export function summarizeDrillOptions(opts: DrillPageOptions): string {
  return summarizeRange(opts.range);
}

// ── Sheet count ──────────────────────────────────────────────────────────────
// Measured against real renders — `__tests__/drill-page-count.test.tsx` pins
// every constant here by rendering the page and counting the sheets react-pdf
// actually laid out. A wrong count does not spoil THIS page (its footer prints
// the true number); it shifts every Contents entry after it. This used to hard-
// return 1 while a drill table of one row per projection year ran to two
// sheets, which is how a client deck listed "Tax Comparison … 13" for a sheet
// that printed on 18.
//
// A data row is `wrap={false}` and every cell is one line, so the table is a
// uniform stack: the count is a fill, not a fit.
//
// ⚠️ COUPLED to the drill page's layout — SectionHead's height, Callout's
// padding, the table's row padding. Change any of those and re-measure; do not
// adjust by arithmetic. The chart is the exception: its height is read from the
// spec below, so a chart that changes size needs nothing here.
const ROW_PT = 14.475; // row-to-row pitch, off the rendered year column
const HEADER_LINE_PT = 7.47; // each column-header line beyond the first
/** Room for rows under the section head, and on a continuation sheet under the
 *  repeating column header. Neither includes the footnote — that competes for
 *  space only on the sheet the table happens to END on, which is why it is
 *  placed separately below rather than folded into these. */
const FIRST_SHEET_PT = 573;
const LATER_SHEET_PT = 654;

// Callout and footnote are advisor- and page-authored prose, so their height
// depends on how the text wraps. react-pdf cannot lay text out synchronously,
// so these two are the only ESTIMATES here; everything else is measured. A
// string landing within a few characters of a wrap can be modelled one line
// out, which costs a sheet only when the row count also sits within one row of
// a break. Widths are the real boxes, derived from the
// frame's own exported page metrics.
const CALLOUT_BOX_PT = 28.0; // 8+8 padding + 12 bottom margin
const CALLOUT_LINE_PT = 12.1;
/** The frame's own content box, read from the frame rather than restated — a
 *  guard that hand-copies these measures a page the product never prints. */
const BODY_WIDTH_PT = PAGE_WIDTH_PORTRAIT - 2 * PAGE_PAD_X;
/** Less the callout's 10pt/12pt padding and its 3pt left rule. */
const CALLOUT_WIDTH_PT = BODY_WIDTH_PT - 25;
const CALLOUT_PT_PER_CHAR = 4.7; // Inter at 10pt across real advisor prose
const FOOTNOTE_TOP_PT = 12; // its marginTop
const FOOTNOTE_LINE_PT = 8.4;
const FOOTNOTE_WIDTH_PT = BODY_WIDTH_PT;
const FOOTNOTE_PT_PER_CHAR = 3.3; // Inter at 7pt

function wrappedLines(text: string, widthPt: number, ptPerChar: number): number {
  return Math.max(1, Math.ceil((text.length * ptPerChar) / widthPt));
}

function calloutHeightPt(text: string | undefined): number {
  if (!text) return 0;
  return CALLOUT_BOX_PT + wrappedLines(text, CALLOUT_WIDTH_PT, CALLOUT_PT_PER_CHAR) * CALLOUT_LINE_PT;
}

function footnoteHeightPt(text: string): number {
  if (!text) return 0;
  return FOOTNOTE_TOP_PT + wrappedLines(text, FOOTNOTE_WIDTH_PT, FOOTNOTE_PT_PER_CHAR) * FOOTNOTE_LINE_PT;
}

/**
 * How many sheets this drill page will occupy.
 *
 * `data` is optional because the registry's contract allows a data-free probe
 * (see `export-pdf-monte-carlo.test.ts`); without it we answer for the single
 * sheet an empty table prints.
 */
export function estimateDrillPageCount(data?: DrillPageData): number {
  if (!data || data.table.rows.length === 0) return 1;

  const headerLines = Math.max(
    1,
    ...data.table.columns.map((c) => c.header.split("\n").length),
  );
  const headerPt = (headerLines - 1) * HEADER_LINE_PT;

  let sheets = 1;
  let remaining =
    FIRST_SHEET_PT -
    headerPt -
    // The chart occupies exactly its declared height, so a page whose chart
    // resizes needs no change here.
    (data.chartSpec?.height ?? 0) -
    calloutHeightPt(data.callout);

  for (let i = 0; i < data.table.rows.length; i++) {
    if (ROW_PT > remaining) {
      sheets += 1;
      remaining = LATER_SHEET_PT - headerPt;
    }
    remaining -= ROW_PT;
  }
  // The footnote follows the last row, and on a full sheet it is what tips the
  // page over — a table ending flush at the bottom prints one more sheet
  // carrying nothing but the disclaimer.
  if (footnoteHeightPt(data.footnote) > remaining) sheets += 1;
  return sheets;
}