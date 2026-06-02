import { z } from "zod";

// Marginal-rate thresholds for the bracket-exposure metrics. Defaults match the
// spec: count years strictly below 22% (opportunity windows) and strictly above
// 24% (high-tax years). Stored as fractions (0.22 = 22%).
export const taxSummaryOptionsSchema = z.object({
  lowThreshold: z.number().min(0).max(1).default(0.22),
  highThreshold: z.number().min(0).max(1).default(0.24),
});

export type TaxSummaryOptions = z.infer<typeof taxSummaryOptionsSchema>;

export const TAX_SUMMARY_OPTIONS_DEFAULT: TaxSummaryOptions = {
  lowThreshold: 0.22,
  highThreshold: 0.24,
};
