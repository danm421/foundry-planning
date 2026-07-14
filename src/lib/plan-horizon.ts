import type { ClientData } from "@/engine/types";

/**
 * Compute the plan-end age (in the primary client's years) from the
 * household's life-expectancy inputs. The plan horizon is the year the last
 * spouse dies, so this returns the primary client's age in that year.
 *
 * Inputs are dates-of-birth and life expectancies for client + optional spouse.
 * When a spouse life expectancy is missing, defaults to 95 to keep the
 * horizon from collapsing to the client's death year.
 */
export function computePlanEndAge(params: {
  clientDob: string;
  clientLifeExpectancy: number;
  spouseDob: string | null;
  spouseLifeExpectancy: number | null;
}): number {
  const clientBirthYear = new Date(params.clientDob).getFullYear();
  const clientDeathYear = clientBirthYear + params.clientLifeExpectancy;

  let lastDeathYear = clientDeathYear;
  if (params.spouseDob) {
    const spouseBirthYear = new Date(params.spouseDob).getFullYear();
    const spouseLE = params.spouseLifeExpectancy ?? 95;
    const spouseDeathYear = spouseBirthYear + spouseLE;
    if (spouseDeathYear > lastDeathYear) lastDeathYear = spouseDeathYear;
  }

  return lastDeathYear - clientBirthYear;
}

/**
 * Solver-side variant: re-derive the plan horizon from a (possibly mutated)
 * client singleton. Same last-death rule as computePlanEndAge, but parses
 * birth years the way the engine does (string slice, no Date/timezone) so the
 * returned planEndYear always matches the engine's death-year math (see
 * engine computeFinalDeathYear), and both LEs fall back to 95 like the engine
 * and the solver sliders do.
 *
 * Returns null when the client DOB is missing or unparsable (minimal solver
 * fixtures) — callers skip the horizon recompute in that case.
 */
export function planHorizonFromLifeExpectancy(client: {
  dateOfBirth?: string | null;
  lifeExpectancy?: number | null;
  spouseDob?: string | null;
  spouseLifeExpectancy?: number | null;
}): { planEndAge: number; planEndYear: number } | null {
  if (!client.dateOfBirth) return null;
  const clientBirthYear = parseInt(String(client.dateOfBirth).slice(0, 4), 10);
  if (!Number.isFinite(clientBirthYear)) return null;

  let lastDeathYear = clientBirthYear + (client.lifeExpectancy ?? 95);
  if (client.spouseDob) {
    const spouseBirthYear = parseInt(String(client.spouseDob).slice(0, 4), 10);
    if (Number.isFinite(spouseBirthYear)) {
      lastDeathYear = Math.max(
        lastDeathYear,
        spouseBirthYear + (client.spouseLifeExpectancy ?? 95),
      );
    }
  }
  return {
    planEndAge: lastDeathYear - clientBirthYear,
    planEndYear: lastDeathYear,
  };
}

/**
 * Return a copy of `tree` whose plan horizon (planSettings.planEndYear and
 * client.planEndAge) is re-derived from the household's life expectancies.
 *
 * Mirrors the scenario-side recompute in `applyMutations` so a base or source
 * projection ends in the same year a mutated scenario would when their life
 * expectancies match. A loaded tree carries its *stored* planEndYear, which can
 * lag the life-expectancy-implied horizon (the facts route re-derives it on
 * every horizon-input change, but the stored value can still drift). Without
 * this reconciliation the shorter projection stops early and the portfolio
 * comparison chart renders the longer side's extra trailing years as an
 * (all-blue) common floor — visually implying the two plans are identical.
 *
 * Pure — never mutates the input. No-op (returns the same reference) when no
 * horizon can be derived (missing/unparsable client DOB), matching
 * planHorizonFromLifeExpectancy's null contract.
 */
export function applyLifeExpectancyHorizon(tree: ClientData): ClientData {
  const horizon = planHorizonFromLifeExpectancy(tree.client);
  if (!horizon) return tree;
  return {
    ...tree,
    client: { ...tree.client, planEndAge: horizon.planEndAge },
    planSettings: { ...tree.planSettings, planEndYear: horizon.planEndYear },
  };
}
