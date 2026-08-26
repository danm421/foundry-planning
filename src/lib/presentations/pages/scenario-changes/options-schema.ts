import { z } from "zod";
import type { ScenarioChangesOptions } from "./types";

export const scenarioChangesOptionsSchema = z.object({
  // `.default("")` so decks and templates saved before the report required a
  // scenario still parse — they land on the same "pick one" state a new page does.
  scenarioId: z.string().default(""),
  title: z.string(),
  showExplanations: z.boolean(),
}) satisfies z.ZodType<ScenarioChangesOptions>;

export const SCENARIO_CHANGES_OPTIONS_DEFAULT: ScenarioChangesOptions = {
  scenarioId: "",
  title: "Plan Comparison",
  showExplanations: true,
};
