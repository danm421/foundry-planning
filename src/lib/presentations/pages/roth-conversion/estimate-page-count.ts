import type { RothConversionPageData, RothConversionYearRow } from "./types";

/** Conversion years the year-by-year sheet holds beside its side panels. */
export const SCHEDULE_FIRST_SHEET_ROWS = 14;
/** Conversion years a continuation sheet holds, with the total and the key. */
export const SCHEDULE_CONTINUED_ROWS = 18;

/**
 * The year-by-year table, cut into sheets. A bracket fill with no end year runs
 * until the IRA is empty — twenty-plus rows is an ordinary plan, not an edge —
 * and a table left to overflow would print a sheet the page count never
 * promised, shifting every Contents number after it.
 *
 * The renderer and the page count both call this, so they cannot disagree.
 */
export function scheduleSheets(rows: RothConversionYearRow[]): RothConversionYearRow[][] {
  const sheets = [rows.slice(0, SCHEDULE_FIRST_SHEET_ROWS)];
  for (let i = SCHEDULE_FIRST_SHEET_ROWS; i < rows.length; i += SCHEDULE_CONTINUED_ROWS) {
    sheets.push(rows.slice(i, i + SCHEDULE_CONTINUED_ROWS));
  }
  return sheets;
}

/** Strategy sheet plus the year-by-year sheet(s); one sheet for the empty state. */
export function estimateRothConversionPageCount(data: RothConversionPageData): number {
  return data.emptyMessage ? 1 : 1 + scheduleSheets(data.schedule).length;
}
