import { describe, it, expect } from "vitest";
import { educationGoalYears, EDUCATION_GOAL_YEARS } from "@/lib/goals";

describe("educationGoalYears", () => {
  const FIRST_YEAR = 2026;

  it("starts the year the beneficiary turns 16", () => {
    // Born 2014 → turns 16 in 2030, which is still ahead of the floor.
    expect(educationGoalYears(2014, FIRST_YEAR).startYear).toBe(2030);
  });

  it("falls back to the first year once that birthday has passed", () => {
    // Born 2001 → turned 16 in 2017. Funding cannot start in the past.
    expect(educationGoalYears(2001, FIRST_YEAR).startYear).toBe(FIRST_YEAR);
  });

  // The gap between the two rules: a 17-year-old's 16th birthday is also behind
  // them, so they take the floor as well — not a start year of 2025.
  it("falls back to the first year for a beneficiary who is 16 or 17 today", () => {
    expect(educationGoalYears(2009, FIRST_YEAR).startYear).toBe(FIRST_YEAR);
  });

  // `endYear` is inclusive in the engine, so a four-year programme ends at
  // start + 3. The span is asserted against the constant so the test breaks if
  // the arithmetic and the constant ever disagree; the constant is pinned
  // separately so "four years" cannot silently become some other number.
  it("runs four inclusive years from whichever start applies", () => {
    expect(EDUCATION_GOAL_YEARS).toBe(4);
    for (const birthYear of [2014, 2001]) {
      const { startYear, endYear } = educationGoalYears(birthYear, FIRST_YEAR);
      expect(endYear - startYear + 1).toBe(EDUCATION_GOAL_YEARS);
    }
  });
});
