import { z } from "zod";

// v1 has no per-instance configuration — the page reads the full plan horizon
// and adapts to the data (mirrors Estate Summary).
export const medicareSummaryOptionsSchema = z.object({});

export type MedicareSummaryOptions = z.infer<typeof medicareSummaryOptionsSchema>;

export const MEDICARE_SUMMARY_OPTIONS_DEFAULT: MedicareSummaryOptions = {};
