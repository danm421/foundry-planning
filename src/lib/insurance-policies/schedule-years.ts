export interface ScheduleYearRangeParams {
  /** Primary client's DOB (ISO date). When null the range can't be derived
   *  from mortality and falls back to the plan horizon. */
  clientDob: string | null;
  lifeExpectancy: number;
  spouseDob: string | null;
  spouseLifeExpectancy: number | null;
  planStartYear: number;
  planEndYear: number;
}

/** Birth year from an ISO date string, parsed from the string directly rather
 *  than via `new Date(...)` — `new Date("1980-01-01").getFullYear()` returns
 *  1979 in a negative-UTC-offset timezone. Mirrors the engine's death-event
 *  helpers, which slice the year for the same reason. */
function birthYear(dob: string): number {
  return parseInt(dob.slice(0, 4), 10);
}

/**
 * Default year range for a life-insurance policy's per-year schedule grid:
 * `planStartYear` → the household's second-to-die (last-survivor) death year.
 *
 * The end year mirrors the engine's last-survivor definition (the later of each
 * spouse's `birthYear + lifeExpectancy`, with a missing spouse life expectancy
 * defaulting to 95). Falls back to `planEndYear` when the client DOB is missing
 * or the computed death year would precede the start. The end is never earlier
 * than the start.
 */
export function computeScheduleYearRange(
  params: ScheduleYearRangeParams,
): { startYear: number; endYear: number } {
  const startYear = params.planStartYear;
  let endYear = params.planEndYear;

  if (params.clientDob) {
    let lastDeathYear = birthYear(params.clientDob) + params.lifeExpectancy;
    if (params.spouseDob) {
      const spouseLE = params.spouseLifeExpectancy ?? 95;
      const spouseDeathYear = birthYear(params.spouseDob) + spouseLE;
      if (spouseDeathYear > lastDeathYear) lastDeathYear = spouseDeathYear;
    }
    if (lastDeathYear >= startYear) endYear = lastDeathYear;
  }

  return { startYear, endYear: Math.max(endYear, startYear) };
}
