import { describe, it, expect } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { earliestRetirementYear, sliceFromRetirement } from "../retirement-window";

// Minimal client factory — only the fields earliestRetirementYear reads.
function client(opts: {
  dob: string;
  retirementAge: number;
  spouseDob?: string;
  spouseRetirementAge?: number;
}): ClientData["client"] {
  return {
    dateOfBirth: opts.dob,
    retirementAge: opts.retirementAge,
    spouseDob: opts.spouseDob,
    spouseRetirementAge: opts.spouseRetirementAge,
  } as ClientData["client"];
}

function yr(year: number): ProjectionYear {
  return { year } as ProjectionYear;
}

describe("earliestRetirementYear", () => {
  it("uses the earlier of the two spouses' retirement years", () => {
    // Cooper born 1970, retires at 65 -> 2035. Susan born 1975, retires at 65 -> 2040.
    const c = client({ dob: "1970-06-01", retirementAge: 65, spouseDob: "1975-03-01", spouseRetirementAge: 65 });
    expect(earliestRetirementYear(c)).toBe(2035);
  });

  it("returns the earlier year even when the younger spouse retires first", () => {
    // Spouse born 1980 retires at 55 -> 2035, primary born 1970 retires at 67 -> 2037.
    const c = client({ dob: "1970-01-01", retirementAge: 67, spouseDob: "1980-01-01", spouseRetirementAge: 55 });
    expect(earliestRetirementYear(c)).toBe(2035);
  });

  it("uses only the client for single-person households", () => {
    const c = client({ dob: "1960-01-01", retirementAge: 66 });
    expect(earliestRetirementYear(c)).toBe(2026);
  });

  it("ignores a spouse dob with no spouse retirement age", () => {
    const c = client({ dob: "1960-01-01", retirementAge: 66, spouseDob: "1962-01-01" });
    expect(earliestRetirementYear(c)).toBe(2026);
  });
});

describe("sliceFromRetirement", () => {
  const years = [2030, 2031, 2032, 2033].map(yr);

  it("keeps only years at or after the retirement year", () => {
    expect(sliceFromRetirement(years, 2032).map((y) => y.year)).toEqual([2032, 2033]);
  });

  it("returns all years when retirement precedes the projection (already retired)", () => {
    expect(sliceFromRetirement(years, 2000).map((y) => y.year)).toEqual([2030, 2031, 2032, 2033]);
  });

  it("falls back to all years when the slice would be empty", () => {
    expect(sliceFromRetirement(years, 2099).map((y) => y.year)).toEqual([2030, 2031, 2032, 2033]);
  });

  it("returns empty for empty input", () => {
    expect(sliceFromRetirement([], 2032)).toEqual([]);
  });
});
