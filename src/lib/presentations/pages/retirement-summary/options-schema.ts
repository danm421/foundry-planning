import { z } from "zod";

// No per-instance options in v1. Empty schema keeps the page registry uniform
// and leaves room to add controls later (e.g. funding time-scope toggle).
export const retirementSummaryOptionsSchema = z.object({});

export type RetirementSummaryOptions = z.infer<typeof retirementSummaryOptionsSchema>;

export const RETIREMENT_SUMMARY_OPTIONS_DEFAULT: RetirementSummaryOptions = {};
