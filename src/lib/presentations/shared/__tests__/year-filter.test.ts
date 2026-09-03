import { describe, it, expect } from "vitest";
import { clipRowsToYears, emptyRangeNote, filterYearsToRange } from "../year-filter";
import type { ProjectionYear } from "@/engine/types";

const years = [{ year: 2026 }, { year: 2027 }, { year: 2028 }] as unknown as ProjectionYear[];

describe("filterYearsToRange", () => {
  it("returns all years for 'full'", () => {
    expect(filterYearsToRange(years, "full").map((y) => y.year)).toEqual([2026, 2027, 2028]);
  });
  it("filters to a custom span", () => {
    expect(
      filterYearsToRange(years, { startYear: 2027, endYear: 2028 }).map((y) => y.year),
    ).toEqual([2027, 2028]);
  });
  it("keeps only the years a Roth conversion moved money", () => {
    const ys = [
      { year: 2026 },
      { year: 2027, rothConversions: [] },
      { year: 2028, rothConversions: [{ id: "a", name: "a", gross: 0, taxable: 0 }] },
      { year: 2029, rothConversions: [{ id: "b", name: "b", gross: 50_000, taxable: 50_000 }] },
      { year: 2030 },
      { year: 2031, rothConversions: [{ id: "c", name: "c", gross: 20_000, taxable: 18_000 }] },
    ] as unknown as ProjectionYear[];
    expect(filterYearsToRange(ys, "rothConversionYears").map((y) => y.year)).toEqual([2029, 2031]);
  });
});

describe("clipRowsToYears", () => {
  it("keeps the rows whose year is visible, in order", () => {
    const rows = [{ year: 2026, v: 1 }, { year: 2027, v: 2 }, { year: 2028, v: 3 }];
    const visible = [{ year: 2028 }, { year: 2026 }] as unknown as ProjectionYear[];
    expect(clipRowsToYears(rows, visible)).toEqual([{ year: 2026, v: 1 }, { year: 2028, v: 3 }]);
  });
});

describe("emptyRangeNote", () => {
  it("speaks only when the Roth-conversion range found nothing", () => {
    expect(emptyRangeNote("rothConversionYears", 0)).toContain("No Roth conversions");
    expect(emptyRangeNote("rothConversionYears", 3)).toBe("");
    expect(emptyRangeNote("full", 0)).toBe("");
    expect(emptyRangeNote({ startYear: 2090, endYear: 2095 }, 0)).toBe("");
  });
});
