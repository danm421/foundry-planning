// src/lib/presentations/pages/retirement-comparison/options-schema.ts
import { z } from "zod";
import type { RetirementComparisonOptions } from "./types";

export const retirementComparisonOptionsSchema = z.object({
  scenarioId: z.string(),
  chartYearRange: z
    .object({ start: z.number(), end: z.number() })
    .nullable(),
  showChanges: z.boolean(),
  showPortfolioMatrix: z.boolean(),
  showAiSummary: z.boolean(),
  ai: z.object({
    tone: z.enum(["concise", "detailed", "plain"]),
    length: z.enum(["short", "medium", "long"]),
    customInstructions: z.string().max(2000),
    generatedText: z.string(),
    generatedAt: z.string().nullable(),
    sourceHash: z.string().nullable(),
  }),
}) satisfies z.ZodType<RetirementComparisonOptions>;

export const RETIREMENT_COMPARISON_OPTIONS_DEFAULT: RetirementComparisonOptions = {
  scenarioId: "",
  chartYearRange: null,
  showChanges: true,
  showPortfolioMatrix: true,
  showAiSummary: true,
  ai: {
    tone: "detailed",
    length: "medium",
    customInstructions: "",
    generatedText: "",
    generatedAt: null,
    sourceHash: null,
  },
};
