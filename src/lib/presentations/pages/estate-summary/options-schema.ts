import { z } from "zod";

export const estateSummaryOptionsSchema = z.object({
  ordering: z.enum(["primaryFirst", "spouseFirst"]).default("primaryFirst"),
});

export type EstateSummaryOptions = z.infer<typeof estateSummaryOptionsSchema>;

export const ESTATE_SUMMARY_OPTIONS_DEFAULT: EstateSummaryOptions = {
  ordering: "primaryFirst",
};
