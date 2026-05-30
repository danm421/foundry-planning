// Pure, framework-free helpers for windowing a retirement projection to the
// retirement period. The Retirement Analysis table + hero chart start at the
// earliest retirement year (eMoney distribution-period convention) so the
// pre-retirement salary-only years don't muddy the income-vs-expense picture.
// The headline + funding KPIs deliberately keep the full-plan horizon — funding
// is a whole-life question — so this only reshapes what the table/chart display.
import type { ClientData, ProjectionYear } from "@/engine/types";

function birthYear(dob: string): number {
  return parseInt(dob.slice(0, 4), 10);
}

/** Calendar year of the earliest retirement across both spouses. Single-person
 *  households (or a spouse dob without a spouse retirement age) use the
 *  client's retirement year alone. */
export function earliestRetirementYear(client: ClientData["client"]): number {
  const clientYear = birthYear(client.dateOfBirth) + client.retirementAge;
  if (client.spouseDob && client.spouseRetirementAge != null) {
    const spouseYear = birthYear(client.spouseDob) + client.spouseRetirementAge;
    return Math.min(clientYear, spouseYear);
  }
  return clientYear;
}

/** Years from `startYear` onward. Falls back to all years when the slice would
 *  be empty (e.g. retirement year past the end of plan, or malformed data) so
 *  the table/chart never render blank. */
export function sliceFromRetirement(
  years: ProjectionYear[],
  startYear: number,
): ProjectionYear[] {
  if (years.length === 0) return years;
  const sliced = years.filter((y) => y.year >= startYear);
  return sliced.length > 0 ? sliced : years;
}
