// "Start the plan next year": when planSettings.dataYear < planStartYear, the
// window [dataYear, planStartYear) already happened. The one statement of that
// rule. No runtime imports, so the flows grid and the lib mirrors of the engine
// can read it without pulling engine modules into their bundles.
import type { PlanSettings } from "./types";

export type SkipWindow = Pick<PlanSettings, "planStartYear" | "dataYear">;

/** True when the plan starts after the year its entered data describes. */
export function hasSkippedYear<T extends SkipWindow>(ps: T): ps is T & { dataYear: number } {
  return ps.dataYear != null && ps.dataYear < ps.planStartYear;
}

export function inSkippedYear(year: number, ps: SkipWindow): boolean {
  return ps.dataYear != null && year >= ps.dataYear && year < ps.planStartYear;
}

/** `row` with its growth base (`inflationStartYear ?? startYear`) moved to the
 *  plan start when it falls in the skipped year; the same row otherwise. */
export function rebaseInflationRow<T extends { startYear: number; inflationStartYear?: number | null }>(
  row: T,
  ps: SkipWindow,
): T {
  return inSkippedYear(row.inflationStartYear ?? row.startYear, ps)
    ? { ...row, inflationStartYear: ps.planStartYear }
    : row;
}

/** The year a row's amount compounds from (`inflationStartYear ?? startYear`).
 *  A base year inside the skipped window moves to the plan start; any other
 *  base year is returned unchanged. */
export function inflationBaseYear(
  row: { startYear: number; inflationStartYear?: number | null },
  ps: SkipWindow,
): number {
  const base = row.inflationStartYear ?? row.startYear;
  return inSkippedYear(base, ps) ? ps.planStartYear : base;
}
