// Year-range filtering shared across drill-down pages. "full" covers the entire
// projection; an explicit {startYear,endYear} clips it.

import type { ClientData, ProjectionYear } from "@/engine/types";

export type RangeOption = "full" | { startYear: number; endYear: number };

export function filterYearsToRange(
  years: ProjectionYear[],
  _clientData: ClientData,
  range: RangeOption,
): ProjectionYear[] {
  if (range === "full") return years;
  return years.filter((y) => y.year >= range.startYear && y.year <= range.endYear);
}
