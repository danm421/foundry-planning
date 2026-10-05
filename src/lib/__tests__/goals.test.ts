import { describe, it, expect } from "vitest";
import {
  educationGoalYears,
  EDUCATION_GOAL_YEARS,
  goalFundingError,
  defaultPayShortfallOutOfPocket,
  GOAL_FUNDING_529_ERROR,
  GOAL_FUNDING_NOT_A_GOAL_ERROR,
} from "@/lib/goals";

describe("educationGoalYears", () => {
  const FIRST_YEAR = 2026;

  it("starts the year the beneficiary turns 18", () => {
    // Born 2014 → turns 18 in 2032, which is still ahead of the floor.
    expect(educationGoalYears(2014, FIRST_YEAR).startYear).toBe(2032);
  });

  it("falls back to the first year once that birthday has passed", () => {
    // Born 2001 → turned 18 in 2019. Funding cannot start in the past.
    expect(educationGoalYears(2001, FIRST_YEAR).startYear).toBe(FIRST_YEAR);
  });

  // The boundary the floor turns on, from both sides: a student who turns 18 in
  // `FIRST_YEAR` starts then (the tie is not pushed out a year), and the one a
  // year older takes the floor rather than a start year of 2025.
  it("starts this year at the 18th birthday and floors anyone older", () => {
    expect(educationGoalYears(2008, FIRST_YEAR).startYear).toBe(FIRST_YEAR);
    expect(educationGoalYears(2007, FIRST_YEAR).startYear).toBe(FIRST_YEAR);
    // The year below the boundary must still land in the future, or the two
    // assertions above would pass on a function that always returns the floor.
    expect(educationGoalYears(2009, FIRST_YEAR).startYear).toBe(2027);
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

describe("goalFundingError", () => {
  const brokerage = { category: "taxable", subType: "brokerage" };
  const plan529 = { category: "education_savings", subType: "529" };

  it("allows no accounts on anything", () => {
    expect(goalFundingError({ type: "living" }, [])).toBeNull();
  });
  it("allows any account, 529s included, on an education goal", () => {
    expect(goalFundingError({ type: "education" }, [plan529, brokerage])).toBeNull();
  });
  it("allows a non-529 account on an Other goal", () => {
    expect(goalFundingError({ type: "other", isGoal: true }, [brokerage])).toBeNull();
  });
  it("refuses a 529 on an Other goal", () => {
    expect(goalFundingError({ type: "other", isGoal: true }, [brokerage, plan529])).toBe(GOAL_FUNDING_529_ERROR);
  });
  it("refuses accounts on an expense that isn't a goal, or isn't Other/education", () => {
    expect(goalFundingError({ type: "other" }, [brokerage])).toBe(GOAL_FUNDING_NOT_A_GOAL_ERROR);
    expect(goalFundingError({ type: "living", isGoal: true }, [brokerage])).toBe(GOAL_FUNDING_NOT_A_GOAL_ERROR);
  });
});

describe("defaultPayShortfallOutOfPocket", () => {
  it("is on only for an Other goal (paid in full from cash flow today)", () => {
    expect(defaultPayShortfallOutOfPocket({ type: "other", isGoal: true })).toBe(true);
    expect(defaultPayShortfallOutOfPocket({ type: "other" })).toBe(false);
    expect(defaultPayShortfallOutOfPocket({ type: "education" })).toBe(false);
  });
});
