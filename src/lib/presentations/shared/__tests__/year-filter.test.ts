import { describe, it, expect } from "vitest";
import { filterYearsToRange } from "../year-filter";
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
});
