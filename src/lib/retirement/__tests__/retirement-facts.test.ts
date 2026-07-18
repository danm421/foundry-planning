import { describe, it, expect } from "vitest";
import { personRetirementFacts, yearsUntilFirstRetirement } from "../retirement-facts";

// Anchored on the real Cooper & Susan Sample household, whose 360 AI profile
// claimed "retire around Cooper's 60th birthday" while the plan says 65.
const TODAY = new Date("2026-07-18T12:00:00Z");

describe("personRetirementFacts", () => {
  it("derives the retirement calendar year from birth year + retirement age", () => {
    const facts = personRetirementFacts(
      { firstName: "Cooper", dateOfBirth: "1975-06-19", retirementAge: 65 },
      TODAY,
    );
    expect(facts).toEqual({
      label: "Cooper",
      currentAge: 51,
      retirementAge: 65,
      retirementYear: 2040,
    });
  });

  it("reads a year younger before this year's birthday", () => {
    const facts = personRetirementFacts(
      { firstName: "Susan", dateOfBirth: "1978-12-31", retirementAge: 65 },
      TODAY,
    );
    expect(facts?.currentAge).toBe(47);
    expect(facts?.retirementYear).toBe(2043);
  });

  // A Jan-1 DOB parsed via `new Date(...)` reads back as the prior year in a
  // negative-UTC timezone, which is why this goes through `@/lib/age-year`.
  // Susan Sample's stored DOB is 1979-01-01: she turns 65 in 2044, not 2043.
  it("does not lose a year on a Jan-1 DOB", () => {
    const facts = personRetirementFacts(
      { firstName: "Susan", dateOfBirth: "1979-01-01", retirementAge: 65 },
      TODAY,
    );
    expect(facts?.retirementYear).toBe(2044);
    expect(facts?.currentAge).toBe(47);
  });

  it("prefers the preferred name over the legal first name", () => {
    const facts = personRetirementFacts(
      { firstName: "Robert", preferredName: "Bob", dateOfBirth: "1970-01-01", retirementAge: 62 },
      TODAY,
    );
    expect(facts?.label).toBe("Bob");
  });

  it("keeps the retirement age when the DOB is unknown", () => {
    const facts = personRetirementFacts({ firstName: "Dana", retirementAge: 67 }, TODAY);
    expect(facts).toEqual({
      label: "Dana",
      currentAge: null,
      retirementAge: 67,
      retirementYear: null,
    });
  });

  it("returns null when there is no retirement age on file", () => {
    expect(personRetirementFacts({ firstName: "Sam" }, TODAY)).toBeNull();
    expect(personRetirementFacts(null, TODAY)).toBeNull();
  });
});

describe("yearsUntilFirstRetirement", () => {
  const cooper = { label: "Cooper", currentAge: 51, retirementAge: 65, retirementYear: 2040 };
  const susan = { label: "Susan", currentAge: 47, retirementAge: 65, retirementYear: 2043 };

  it("counts to the earliest retirement year in the household", () => {
    expect(yearsUntilFirstRetirement([cooper, susan], TODAY)).toBe(14);
    expect(yearsUntilFirstRetirement([susan, cooper], TODAY)).toBe(14);
  });

  it("floors at zero once the retirement year has passed", () => {
    const retired = { ...cooper, retirementYear: 2019 };
    expect(yearsUntilFirstRetirement([retired], TODAY)).toBe(0);
  });

  it("ignores people with no derivable retirement year", () => {
    const noDob = { label: "Dana", currentAge: null, retirementAge: 60, retirementYear: null };
    expect(yearsUntilFirstRetirement([noDob, susan], TODAY)).toBe(17);
    expect(yearsUntilFirstRetirement([noDob], TODAY)).toBeNull();
    expect(yearsUntilFirstRetirement([], TODAY)).toBeNull();
  });
});
