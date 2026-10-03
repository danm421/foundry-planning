import { describe, it, expect } from "vitest";
import {
  estimateRothConversionPageCount,
  scheduleSheets,
  SCHEDULE_CONTINUED_ROWS,
  SCHEDULE_FIRST_SHEET_ROWS,
} from "../estimate-page-count";
import type { RothConversionPageData, RothConversionYearRow } from "../types";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ year: 2030 + i }) as RothConversionYearRow);
const data = (n: number, emptyMessage: string | null = null) =>
  ({ emptyMessage, schedule: rows(n) }) as RothConversionPageData;

describe("scheduleSheets", () => {
  it("keeps a short schedule on the year-by-year sheet", () => {
    expect(scheduleSheets(rows(5)).map((s) => s.length)).toEqual([5]);
    expect(scheduleSheets(rows(SCHEDULE_FIRST_SHEET_ROWS))).toHaveLength(1);
  });

  it("carries the rest onto full-width continuation sheets, in order", () => {
    const n = SCHEDULE_FIRST_SHEET_ROWS + SCHEDULE_CONTINUED_ROWS + 3;
    const sheets = scheduleSheets(rows(n));
    expect(sheets.map((s) => s.length)).toEqual([SCHEDULE_FIRST_SHEET_ROWS, SCHEDULE_CONTINUED_ROWS, 3]);
    expect(sheets.flat().map((r) => r.year)).toEqual(rows(n).map((r) => r.year));
  });
});

describe("estimateRothConversionPageCount", () => {
  it("counts the strategy sheet plus every year-by-year sheet", () => {
    expect(estimateRothConversionPageCount(data(5))).toBe(2);
    expect(estimateRothConversionPageCount(data(SCHEDULE_FIRST_SHEET_ROWS + 1))).toBe(3);
  });

  it("counts one sheet for the empty state", () => {
    expect(estimateRothConversionPageCount(data(0, "This plan has no Roth conversions."))).toBe(1);
  });
});
