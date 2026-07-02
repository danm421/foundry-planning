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
