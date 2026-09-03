// Year-range filtering shared across drill-down pages. "full" covers the entire
// projection; an explicit {startYear,endYear} clips it; a named range keeps the
// years that match a rule — "rothConversionYears" is offered by the Tax Bracket
// pages, since sizing a conversion is what those pages are for.

import type { ProjectionYear } from "@/engine/types";

/** Ranges a page can offer by name, beyond the whole projection. */
export type NamedRange = "rothConversionYears";

export type RangeOption =
  | "full"
  | NamedRange
  | { startYear: number; endYear: number };

/** A year counts when a conversion actually moved money — a strategy that
 *  found no bracket room would only add a blank row. */
function hasRothConversion(y: ProjectionYear): boolean {
  return (y.rothConversions ?? []).some((c) => c.gross > 0);
}

export function filterYearsToRange(
  years: ProjectionYear[],
  range: RangeOption,
): ProjectionYear[] {
  if (range === "full") return years;
  if (range === "rothConversionYears") return years.filter(hasRothConversion);
  return years.filter((y) => y.year >= range.startYear && y.year <= range.endYear);
}

/** Clip rows built over the whole projection to the visible years. Building
 *  first and clipping after keeps a row's year-over-year figures honest when
 *  the range hides the year before it. */
export function clipRowsToYears<T extends { year: number }>(
  rows: T[],
  visibleYears: ProjectionYear[],
): T[] {
  const visible = new Set(visibleYears.map((y) => y.year));
  return rows.filter((r) => visible.has(r.year));
}

/** A named range can match nothing; the page says so rather than printing an
 *  empty table under a silent heading. "" when there is nothing to say. */
export function emptyRangeNote(range: RangeOption, rowCount: number): string {
  if (rowCount > 0 || range !== "rothConversionYears") return "";
  return "No Roth conversions are modeled in this plan, so there are no years to show. ";
}
