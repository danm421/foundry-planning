import { describe, it, expect } from "vitest";
import { computeScheduleYearRange } from "../schedule-years";

const base = {
  planStartYear: 2026,
  planEndYear: 2065,
};

describe("computeScheduleYearRange", () => {
  it("ends at the later of the two spouses' death years (second to die)", () => {
    const { startYear, endYear } = computeScheduleYearRange({
      ...base,
      clientDob: "1970-06-01",
      lifeExpectancy: 90, // → 2060
      spouseDob: "1972-03-01",
      spouseLifeExpectancy: 90, // → 2062
    });
    expect(startYear).toBe(2026);
    expect(endYear).toBe(2062);
  });

  it("uses the client's own death year when there is no spouse", () => {
    const { endYear } = computeScheduleYearRange({
      ...base,
      clientDob: "1970-06-01",
      lifeExpectancy: 95, // → 2065
      spouseDob: null,
      spouseLifeExpectancy: null,
    });
    expect(endYear).toBe(2065);
  });

  it("defaults a missing spouse life expectancy to 95", () => {
    const { endYear } = computeScheduleYearRange({
      ...base,
      clientDob: "1970-06-01",
      lifeExpectancy: 85, // → 2055
      spouseDob: "1980-01-01",
      spouseLifeExpectancy: null, // → 1980 + 95 = 2075
    });
    expect(endYear).toBe(2075);
  });

  it("falls back to planEndYear when the client DOB is missing", () => {
    const { endYear } = computeScheduleYearRange({
      ...base,
      clientDob: null,
      lifeExpectancy: 95,
      spouseDob: null,
      spouseLifeExpectancy: null,
    });
    expect(endYear).toBe(2065);
  });

  it("falls back to planEndYear when the computed death year precedes the start", () => {
    const { startYear, endYear } = computeScheduleYearRange({
      ...base,
      clientDob: "1900-01-01",
      lifeExpectancy: 95, // → 1995, before 2026
      spouseDob: null,
      spouseLifeExpectancy: null,
    });
    expect(startYear).toBe(2026);
    expect(endYear).toBe(2065);
  });

  it("never returns an end year before the start year", () => {
    const { startYear, endYear } = computeScheduleYearRange({
      clientDob: null,
      lifeExpectancy: 95,
      spouseDob: null,
      spouseLifeExpectancy: null,
      planStartYear: 2026,
      planEndYear: 2000, // degenerate settings
    });
    expect(endYear).toBeGreaterThanOrEqual(startYear);
  });
});
