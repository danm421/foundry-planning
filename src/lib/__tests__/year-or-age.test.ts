import { describe, it, expect } from "vitest";
import { agesInYear, householdAgePeople, readYearOrAge } from "@/lib/year-or-age";

describe("readYearOrAge", () => {
  it("reads four digits as a year", () => {
    expect(readYearOrAge("2041", 1976)).toEqual({ kind: "year", year: 2041, inRange: true });
  });

  it("says whether the year falls in the allowed span", () => {
    expect(readYearOrAge("1999", 1976)?.inRange).toBe(false);
    expect(readYearOrAge("2034", 1976, { min: 2035 })?.inRange).toBe(false);
    // Age 20 lands in 1996 — a reading, but out of the default span.
    expect(readYearOrAge("20", 1976)).toEqual({ kind: "age", age: 20, year: 1996, inRange: false });
  });

  it("reads two or three digits as the client's age", () => {
    expect(readYearOrAge("65", 1976)).toEqual({ kind: "age", age: 65, year: 2041, inRange: true });
    expect(readYearOrAge(" 100 ", 1976)).toEqual({ kind: "age", age: 100, year: 2076, inRange: true });
  });

  it("reads nothing from one digit, non-digits, or an age with no birth year", () => {
    expect(readYearOrAge("6", 1976)).toBeNull();
    expect(readYearOrAge("", 1976)).toBeNull();
    expect(readYearOrAge("20a1", 1976)).toBeNull();
    expect(readYearOrAge("65", undefined)).toBeNull();
    // A year never needs a birth year.
    expect(readYearOrAge("2041", undefined)).toEqual({ kind: "year", year: 2041, inRange: true });
  });
});

describe("agesInYear", () => {
  const people = [
    { name: "Dan", birthYear: 1976 },
    { name: "Jane", birthYear: 1978 },
  ];

  it("gives each person's age that year", () => {
    expect(agesInYear(2041, people)).toEqual([
      { name: "Dan", age: 65 },
      { name: "Jane", age: 63 },
    ]);
  });

  it("skips anyone not yet born", () => {
    expect(agesInYear(1977, people)).toEqual([{ name: "Dan", age: 1 }]);
  });
});

describe("householdAgePeople", () => {
  it("lists the client first and drops anyone without a birth year", () => {
    expect(householdAgePeople({ clientBirthYear: 1976, spouseBirthYear: 1978 }, { client: "Dan", spouse: "Jane" }))
      .toEqual([{ name: "Dan", birthYear: 1976 }, { name: "Jane", birthYear: 1978 }]);
    expect(householdAgePeople({ spouseBirthYear: 1978 }, { client: "Dan", spouse: "Jane" }))
      .toEqual([{ name: "Jane", birthYear: 1978 }]);
  });
});
