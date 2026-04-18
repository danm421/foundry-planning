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
