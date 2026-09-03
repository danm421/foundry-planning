import { z } from "zod";

export interface TaxComparisonOptions {
  /** Comparison scenario id; "" = unset. */
  scenarioId: string;
  /** The left-hand plan. "base" = Base Case; otherwise a live scenario id. */
  baselineScenarioId: string;
  lowThreshold: number;
  highThreshold: number;
}

export const taxComparisonOptionsSchema = z.object({
  scenarioId: z.string(),
  baselineScenarioId: z.string().default("base"),
  lowThreshold: z.number().min(0).max(1).default(0.22),
  highThreshold: z.number().min(0).max(1).default(0.24),
}) satisfies z.ZodType<TaxComparisonOptions>;

export const TAX_COMPARISON_OPTIONS_DEFAULT: TaxComparisonOptions = {
  scenarioId: "",
  baselineScenarioId: "base",
  lowThreshold: 0.22,
  highThreshold: 0.24,
};
