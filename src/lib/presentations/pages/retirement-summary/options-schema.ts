import { z } from "zod";

export const retirementSummaryOptionsSchema = z.object({
  /** The optional "Max sustainable spend" KPI: the most the plan can spend each
   *  year in retirement (today's dollars) and still hold this Monte Carlo
   *  confidence. Off by default — the solve costs seconds the first time.
   *  Defaulted because decks saved before it existed carry `{}`. */
  maxSpend: z
    .object({
      show: z.boolean(),
      targetConfidence: z.number().min(0.5).max(0.99),
    })
    .default({ show: false, targetConfidence: 0.85 }),
});

export type RetirementSummaryOptions = z.infer<typeof retirementSummaryOptionsSchema>;

export const RETIREMENT_SUMMARY_OPTIONS_DEFAULT: RetirementSummaryOptions = retirementSummaryOptionsSchema.parse({});
