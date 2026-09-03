import { z } from "zod";
import type { ScenarioChangesOptions } from "./types";

/** The report's name before it became "Plan Changes". Decks and templates saved
 *  under the old name stored it in their own options, so the printed heading
 *  would still say "Plan Comparison" while the Contents (registry title) and the
 *  sheet's eyebrow said "Plan Changes". `titleFor` retires it at render time. */
const RETIRED_TITLE = "Plan Comparison";

export const scenarioChangesOptionsSchema = z.object({
  // `.default("")` so decks and templates saved before the report required a
  // scenario still parse — they land on the same "pick one" state a new page does.
  scenarioId: z.string().default(""),
  title: z.string(),
  showExplanations: z.boolean(),
}) satisfies z.ZodType<ScenarioChangesOptions>;

export const SCENARIO_CHANGES_OPTIONS_DEFAULT: ScenarioChangesOptions = {
  scenarioId: "",
  title: "Plan Changes",
  showExplanations: true,
};

/** The heading to print. An advisor's own title is honoured; only the retired
 *  default is rewritten. */
export function titleFor(options: ScenarioChangesOptions): string {
  return options.title === RETIRED_TITLE ? SCENARIO_CHANGES_OPTIONS_DEFAULT.title : options.title;
}
