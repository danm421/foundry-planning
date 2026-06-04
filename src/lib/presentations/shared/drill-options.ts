// Shared options helpers for every cash-flow drill-down page. Each drill page
// references these from its registry entry so behavior stays uniform.

import { z } from "zod";
import type { DrillPageOptions } from "./drill-types";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "../types";

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
  z.union([z.literal("full"), customRange]),
);

export const drillOptionsSchema = z.object({
  range: rangeSchema,
  showCallout: z.boolean(),
  calloutText: z.string().optional(),
}) satisfies z.ZodType<DrillPageOptions>;

export const DRILL_PAGE_OPTIONS_DEFAULT: DrillPageOptions =
  CASH_FLOW_PAGE_OPTIONS_DEFAULT;

export function summarizeDrillOptions(opts: DrillPageOptions): string {
  if (opts.range === "full") return "Full range";
  return `${opts.range.startYear}–${opts.range.endYear}`; // en-dash U+2013
}

export function estimateDrillPageCount(): number {
  return 1;
}
