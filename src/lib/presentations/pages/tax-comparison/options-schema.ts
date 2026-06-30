import { z } from "zod";

export interface TaxComparisonOptions {
  /** Comparison scenario id; baseline is always Base Case. "" = unset. */
  scenarioId: string;
  lowThreshold: number;
  highThreshold: number;
}

export const taxComparisonOptionsSchema = z.object({
  scenarioId: z.string(),
  lowThreshold: z.number().min(0).max(1).default(0.22),
  highThreshold: z.number().min(0).max(1).default(0.24),
}) satisfies z.ZodType<TaxComparisonOptions>;

export const TAX_COMPARISON_OPTIONS_DEFAULT: TaxComparisonOptions = {
  scenarioId: "",
  lowThreshold: 0.22,
  highThreshold: 0.24,
};
