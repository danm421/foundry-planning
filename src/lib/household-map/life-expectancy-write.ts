// src/lib/household-map/life-expectancy-write.ts
//
// Write payloads for the Goals board's inline life-expectancy editor.
//
// Life expectancy is the ONLY field on this page that moves the plan horizon:
// the engine's year loop is bounded by `planSettings.planEndYear`
// (`engine/projection.ts`, `year <= planSettings.planEndYear`), and
// `clients.plan_end_age` is derived from the two life expectancies rather than
// stored independently. So a write that changes one without the others leaves
// the projection running to the OLD year while the boards display the new one.
// Both modes below carry the whole horizon, by different routes:
//
//   Base mode     -> `PUT /api/clients/[id]` with just the changed column. The
//                    route re-derives `planEndAge` itself and pushes the new
//                    `planEndYear` to every one of the client's plan_settings
//                    rows (see the `dobChanged || leChanged || ...` block). We
//                    must NOT send `planEndAge`: the route would accept our
//                    value into `MUTABLE_CLIENT_FIELDS` and then overwrite it
//                    with its own — sending it only invites the two to drift.
//
//   Scenario mode -> TWO `scenario_changes` rows, because `planEndAge` lives on
//                    the `client` singleton and `planEndYear` on `plan_settings`,
//                    and a scenario_change row targets exactly one kind.
//
// Both scenario payloads carry the WHOLE effective singleton, not just the
// changed keys — the same rule (and the same reason) as `flow-write.ts` and
// `account-write.ts`. The singletons themselves are pruned by the shared
// `pruneScenarioFields` (`@/lib/inline-edit/scenario-fields`) with NO strip set: unlike a flow
// row, a `client` / `planSettings` singleton has no key that must be withheld.
// `applyEntityEdit` upserts with `set: { payload: diff }`, a
// wholesale replace, and `buildFieldDiff` only emits keys the caller sent. A
// narrow `{ lifeExpectancy }` write against a scenario that ALSO overrides
// `retirementAge` (exactly what the Solver writes) would delete the retirement
// override — silently. Diffing the whole effective singleton against base makes
// the new payload "every override this scenario already had, plus this one".

import { planHorizonFromLifeExpectancy } from "@/lib/plan-horizon";
import type { LifeExpectancyOwner } from "./goals";

/**
 * Upper bound, mirroring the Solver's life-expectancy sliders
 * (`solver-row-life-expectancy.tsx`, `max={110}`). The two editors must not
 * disagree about what a plausible age is.
 */
export const MAX_LIFE_EXPECTANCY = 110;

/** The `clients` column each owner writes. */
const COLUMN_FOR: Record<LifeExpectancyOwner, "lifeExpectancy" | "spouseLifeExpectancy"> = {
  client: "lifeExpectancy",
  spouse: "spouseLifeExpectancy",
};

/**
 * Whether `age` is a life expectancy this household can actually be projected
 * with.
 *
 * The lower bound is the person's CURRENT age, not 0 or 1. Below it the derived
 * death year lands before the plan even starts, and `computeFinalDeathYear`
 * returns null for `finalDeathYear < planStartYear` — the projection then runs
 * with no death event at all rather than with an early one, which is not what
 * anyone typing "40" into the field meant. Equal to the current age is allowed:
 * that is a death in the plan's first year, which the engine does model.
 *
 * `currentYear` is a parameter rather than a `new Date()` call so this stays
 * pure and testable, and so the caller's year is the same one the rest of the
 * page derived its ages from.
 */
export function isValidLifeExpectancy(
  age: number,
  birthYear: number | null,
  currentYear: number,
): boolean {
  if (!Number.isInteger(age)) return false;
  if (age > MAX_LIFE_EXPECTANCY) return false;
  if (birthYear == null) return false;
  return age >= currentYear - birthYear;
}

/**
 * Base-mode body: the one changed column. Partial — the PUT route's
 * `MUTABLE_CLIENT_FIELDS` loop copies only the keys present in the body, so
 * everything else on the row is left alone.
 */
export function lifeExpectancyBasePayload(
  owner: LifeExpectancyOwner,
  age: number,
): Record<string, number> {
  return { [COLUMN_FOR[owner]]: age };
}

/** The horizon implied by `clientFields` once `owner`'s life expectancy is `age`. */
function horizonAfter(
  clientFields: Record<string, unknown>,
  owner: LifeExpectancyOwner,
  age: number,
): { planEndAge: number; planEndYear: number } | null {
  const next = { ...clientFields, [COLUMN_FOR[owner]]: age };
  return planHorizonFromLifeExpectancy({
    dateOfBirth: next.dateOfBirth as string | null | undefined,
    lifeExpectancy: next.lifeExpectancy as number | null | undefined,
    spouseDob: next.spouseDob as string | null | undefined,
    spouseLifeExpectancy: next.spouseLifeExpectancy as number | null | undefined,
  });
}

/**
 * Scenario payload for the `client` singleton: every field this scenario already
 * overrides, plus the new life expectancy and the `planEndAge` it implies.
 *
 * `planEndAge` is re-derived here (not left to a server route) because no server
 * route is involved — the scenario writer stores the diff verbatim. It is the
 * primary client's age in the year the LAST spouse dies, so BOTH life
 * expectancies feed it and a spouse-side edit moves it just as a client-side one
 * does. `planHorizonFromLifeExpectancy` is the shared derivation, shared with the
 * Solver and the base PUT route so all three agree.
 */
export function buildLifeExpectancyClientFields(
  clientFields: Record<string, unknown>,
  owner: LifeExpectancyOwner,
  age: number,
): Record<string, unknown> {
  const horizon = horizonAfter(clientFields, owner, age);
  return {
    ...clientFields,
    [COLUMN_FOR[owner]]: age,
    // Omitted, not nulled, when the DOB is unparseable: `planEndAge` is NOT NULL
    // on the base row, and a `{ from: 95, to: undefined }` diff would blank the
    // plan horizon for the whole scenario. Leaving the key out keeps the
    // scenario on its existing planEndAge, which is stale but projectable.
    ...(horizon ? { planEndAge: horizon.planEndAge } : {}),
  };
}

/**
 * Scenario payload for the `plan_settings` singleton: every field this scenario
 * already overrides, plus the new `planEndYear`.
 *
 * Returns null when the horizon can't be derived — the caller then skips the
 * second write entirely rather than posting a no-op that would still replace the
 * scenario's existing plan_settings payload.
 */
export function buildLifeExpectancyPlanSettingsFields(
  planSettingsFields: Record<string, unknown>,
  clientFields: Record<string, unknown>,
  owner: LifeExpectancyOwner,
  age: number,
): Record<string, unknown> | null {
  const horizon = horizonAfter(clientFields, owner, age);
  if (!horizon) return null;
  return { ...planSettingsFields, planEndYear: horizon.planEndYear };
}
