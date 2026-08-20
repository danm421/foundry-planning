/**
 * Everything the portal's savings goal calculator needs, in one server pass:
 * the household's own inflation assumption, plus whatever setup the client
 * saved last time.
 *
 * The inflation rate is the ONLY thing this calculator reads from the plan —
 * but it is not simply the `plan_settings.inflation_rate` column. That column
 * is live only when `inflation_rate_source` is "custom"; on the default
 * "asset_class" the plan runs on the firm's Inflation asset class (or the
 * client's own CMA override of it) and the column is ignored. Resolving it the
 * same way the engine does is what lets the screen say "your plan's X%
 * inflation" and be telling the truth. `load-client-data.ts` does the identical
 * resolution for the projection; both call `resolveInflationRate` rather than
 * re-deriving the rule.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assetClasses,
  clientCmaOverrides,
  clients,
  planSettings,
  portalCalculatorStates,
  scenarios,
} from "@/db/schema";
import { resolveInflationRate } from "@/lib/inflation";
import {
  createDefaultSavingsGoalState,
  validateSavingsGoalState,
  type SavingsGoalState,
} from "@/lib/calculators/savings-goal-state";

export const SAVINGS_GOAL_KEY = "savings-goal";

/** `plan_settings.inflation_rate`'s own column default. */
export const FALLBACK_INFLATION_RATE = 0.03;

export interface SavingsGoalDTO {
  /**
   * Annual FRACTION — the household's RESOLVED plan inflation, the same number
   * the projection engine compounds with.
   */
  inflationRate: number;
  state: SavingsGoalState;
}

export async function loadSavingsGoal(clientId: string): Promise<SavingsGoalDTO> {
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  const [settings, saved, inflationClasses] = await Promise.all([
    scenario
      ? db
          .select({
            inflationRate: planSettings.inflationRate,
            inflationRateSource: planSettings.inflationRateSource,
            useCustomCma: planSettings.useCustomCma,
          })
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
    // Joined to `clients` rather than read after a firm_id lookup so the firm's
    // Inflation class costs no extra round trip. (firm_id, slug) is unique, so
    // this is at most one row.
    db
      .select({
        id: assetClasses.id,
        geometricReturn: assetClasses.geometricReturn,
      })
      .from(assetClasses)
      .innerJoin(clients, eq(clients.firmId, assetClasses.firmId))
      .where(and(eq(clients.id, clientId), eq(assetClasses.slug, "inflation")))
      .limit(1),
  ]);

  const settingsRow = settings[0];
  const inflationClass = inflationClasses[0] ?? null;

  // Only the plans that opted into a custom CMA can override the firm's class,
  // so this fourth query stays off the common path entirely.
  let clientOverride: { geometricReturn: string } | null = null;
  if (settingsRow?.useCustomCma && inflationClass) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(
        and(
          eq(clientCmaOverrides.clientId, clientId),
          eq(clientCmaOverrides.sourceAssetClassId, inflationClass.id),
        ),
      )
      .limit(1);
    clientOverride = override ?? null;
  }

  const resolved = settingsRow
    ? resolveInflationRate(
        {
          inflationRateSource: settingsRow.inflationRateSource,
          inflationRate: settingsRow.inflationRate,
        },
        inflationClass,
        clientOverride,
      )
    : undefined;

  // Drizzle hands back a `decimal` column as a STRING ("0.0300"), and
  // `resolveInflationRate` coerces without validating. A rate that is NaN or
  // wildly mis-scaled would make every downstream compounding step nonsense —
  // the screen would show "$NaN a month", or compound the goal at 500% a year,
  // rather than failing.
  const inflationRate =
    resolved != null && Number.isFinite(resolved) && resolved >= 0 && resolved <= 1
      ? resolved
      : FALLBACK_INFLATION_RATE;

  // A stored payload that no longer validates — an older shape, a hand-edited
  // row — falls back to the defaults rather than 500ing the page.
  const state = saved[0] ? validateSavingsGoalState(saved[0].state) : null;

  return {
    inflationRate,
    state: state?.ok ? state.state : createDefaultSavingsGoalState(),
  };
}
