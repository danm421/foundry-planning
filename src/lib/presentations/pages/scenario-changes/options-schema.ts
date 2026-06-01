import { z } from "zod";
import type { ScenarioChangesOptions } from "./types";

export const scenarioChangesOptionsSchema = z.object({
  title: z.string(),
  showExplanations: z.boolean(),
}) satisfies z.ZodType<ScenarioChangesOptions>;

export const SCENARIO_CHANGES_OPTIONS_DEFAULT: ScenarioChangesOptions = {
  title: "Scenario Changes",
  showExplanations: true,
};
