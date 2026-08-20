/**
 * Everything the portal's savings goal calculator needs, in one server pass:
 * the household's own inflation assumption, plus whatever setup the client
 * saved last time.
 *
 * The inflation rate is the ONLY thing this calculator reads from the plan.
 * `load-organizer-map.ts` gets the same field through `loadEffectiveTree`,
 * which builds the entire plan tree — far more work than one number is worth,
 * so this reads the column directly.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { planSettings, portalCalculatorStates, scenarios } from "@/db/schema";
import {
  createDefaultSavingsGoalState,
  validateSavingsGoalState,
  type SavingsGoalState,
} from "@/lib/calculators/savings-goal-state";

export const SAVINGS_GOAL_KEY = "savings-goal";

/** `plan_settings.inflation_rate`'s own column default. */
export const FALLBACK_INFLATION_RATE = 0.03;

export interface SavingsGoalDTO {
  /** Annual FRACTION, from the household's base-case plan settings. */
  inflationRate: number;
  state: SavingsGoalState;
}

export async function loadSavingsGoal(clientId: string): Promise<SavingsGoalDTO> {
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  const [settings, saved] = await Promise.all([
    scenario
      ? db
          .select({ inflationRate: planSettings.inflationRate })
          .from(planSettings)
          .where(
            and(
              eq(planSettings.clientId, clientId),
              eq(planSettings.scenarioId, scenario.id),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ state: portalCalculatorStates.state })
      .from(portalCalculatorStates)
      .where(
        and(
          eq(portalCalculatorStates.clientId, clientId),
          eq(portalCalculatorStates.calculatorKey, SAVINGS_GOAL_KEY),
        ),
      )
      .limit(1),
  ]);

  // Drizzle hands back a `decimal` column as a STRING ("0.0300"). Used
  // un-coerced it makes every downstream compounding step NaN, and the screen
  // would quietly show "$NaN a month" rather than failing.
  const parsed = Number(settings[0]?.inflationRate);
  const inflationRate =
    Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? parsed
      : FALLBACK_INFLATION_RATE;

  // A stored payload that no longer validates — an older shape, a hand-edited
  // row — falls back to the defaults rather than 500ing the page.
  const state = saved[0] ? validateSavingsGoalState(saved[0].state) : null;

  return {
    inflationRate,
    state: state?.ok ? state.state : createDefaultSavingsGoalState(),
  };
}
