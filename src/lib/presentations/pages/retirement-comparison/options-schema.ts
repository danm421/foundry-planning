// src/lib/presentations/pages/retirement-comparison/options-schema.ts
import { z } from "zod";
import type { RetirementComparisonOptions } from "./types";

export const retirementComparisonOptionsSchema = z.object({
  scenarioId: z.string(),
  showPortfolioMatrix: z.boolean(),
  showAiSummary: z.boolean(),
  showConfidenceRange: z.boolean(),
  maxSpend: z.object({
    show: z.boolean(),
    targetConfidence: z.number().min(0.5).max(0.99),
  }),
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
  showPortfolioMatrix: true,
  showAiSummary: true,
  showConfidenceRange: true,
  maxSpend: { show: true, targetConfidence: 0.85 },
  ai: {
    tone: "detailed",
    length: "medium",
    customInstructions: "",
    generatedText: "",
    generatedAt: null,
    sourceHash: null,
  },
};
