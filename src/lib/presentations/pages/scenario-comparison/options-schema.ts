import { z } from "zod";
import type { ScenarioComparisonOptions } from "./types";

const bandAiSchema = z.object({
  generatedText: z.string(),
  generatedAt: z.string().nullable(),
  sourceHash: z.string().nullable(),
});

export const scenarioComparisonOptionsSchema = z.object({
  // .default([]) is load-bearing: deck options are re-parsed through this
  // schema at the API boundary, so a template or saved deck written before
  // this page existed must still parse rather than 400.
  scenarioIds: z.array(z.string()).max(3).default([]),
  maxSpend: z.object({
    show: z.boolean(),
    targetConfidence: z.number().min(0.5).max(0.99),
  }),
  showChart: z.boolean(),
  showTradeoffBands: z.boolean(),
  ai: z.object({
    tone: z.enum(["concise", "detailed", "plain"]),
    customInstructions: z.string().max(2000),
    byScenario: z.record(z.string(), bandAiSchema).default({}),
  }),
}) satisfies z.ZodType<ScenarioComparisonOptions>;

export const SCENARIO_COMPARISON_OPTIONS_DEFAULT: ScenarioComparisonOptions = {
  scenarioIds: [],
  maxSpend: { show: true, targetConfidence: 0.85 },
  showChart: true,
  showTradeoffBands: true,
  ai: { tone: "detailed", customInstructions: "", byScenario: {} },
};
