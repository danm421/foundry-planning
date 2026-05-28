// Shared options helpers for every cash-flow drill-down page. Each drill
// page references these directly from its registry entry so behavior stays
// uniform across drills.

import { z } from "zod";
import type {
  DrillPageOptions,
} from "./drill-types";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "../types";

const customRange = z
  .object({
    startYear: z.number().int(),
    endYear: z.number().int(),
  })
  .refine((r) => r.endYear >= r.startYear, {
    message: "endYear must be >= startYear",
  });

export const drillOptionsSchema = z.object({
  range: z.union([z.literal("retirement"), z.literal("lifetime"), customRange]),
  showCallout: z.boolean(),
  calloutText: z.string().optional(),
}) satisfies z.ZodType<DrillPageOptions>;

export const DRILL_PAGE_OPTIONS_DEFAULT: DrillPageOptions =
  CASH_FLOW_PAGE_OPTIONS_DEFAULT;

export function summarizeDrillOptions(opts: DrillPageOptions): string {
  if (opts.range === "retirement") return "Retirement only";
  if (opts.range === "lifetime") return "Lifetime";
  return `${opts.range.startYear}–${opts.range.endYear}`;
}

export function estimateDrillPageCount(): number {
  return 1;
}
