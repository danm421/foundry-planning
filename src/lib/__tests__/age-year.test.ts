import { describe, it, expect } from "vitest";
import { birthYearFromDob, yearForAge, ageForYear, ageOnDate } from "@/lib/age-year";

describe("birthYearFromDob", () => {
  it("slices the year from an ISO date string", () => {
    expect(birthYearFromDob("1980-05-15")).toBe(1980);
    expect(birthYearFromDob("1980-05-15T00:00:00.000Z")).toBe(1980);
  });

  it("does not shift the year for a Jan-1 DOB (no timezone parsing)", () => {
    // new Date('1980-01-01').getFullYear() reads back 1979 in negative-UTC
    // zones — the string slice must not.
    expect(birthYearFromDob("1980-01-01")).toBe(1980);
  });

  it("returns null for missing or unparseable input", () => {
    expect(birthYearFromDob(null)).toBeNull();
    expect(birthYearFromDob(undefined)).toBeNull();
    expect(birthYearFromDob("")).toBeNull();
    expect(birthYearFromDob("not-a-date")).toBeNull();
  });
});

describe("yearForAge", () => {
  it("returns the calendar year the person reaches the age", () => {
    expect(yearForAge(1980, 65)).toBe(2045);
    expect(yearForAge(1980, 0)).toBe(1980);
  });

  it("returns null when the birth year is unknown", () => {
    expect(yearForAge(null, 65)).toBeNull();
  });
});

describe("ageForYear", () => {
  it("inverts yearForAge", () => {
    expect(ageForYear(1980, 2045)).toBe(65);
    expect(ageForYear(1980, 1980)).toBe(0);
  });

  it("returns null when the birth year is unknown", () => {
    expect(ageForYear(null, 2045)).toBeNull();
  });
});

describe("ageOnDate", () => {
  const TODAY = new Date("2026-07-18T12:00:00Z");

  it("counts a birthday that has already passed this year", () => {
    expect(ageOnDate("1975-06-20", TODAY)).toBe(51);
  });

  it("reads a year younger before this year's birthday", () => {
    expect(ageOnDate("1975-12-25", TODAY)).toBe(50);
  });

  it("turns the age exactly on the birthday", () => {
    expect(ageOnDate("1975-07-18", TODAY)).toBe(51);
    expect(ageOnDate("1975-07-19", TODAY)).toBe(50);
  });

  it("does not shift a Jan-1 DOB", () => {
    // new Date('1979-01-01') lands on 1978-12-31 in negative-UTC zones.
    expect(ageOnDate("1979-01-01", TODAY)).toBe(47);
  });

  it("returns a sub-1 age for an infant", () => {
    expect(ageOnDate("2026-03-01", TODAY)).toBe(0);
  });

  it("returns null for missing or unparseable input", () => {
    expect(ageOnDate(null, TODAY)).toBeNull();
    expect(ageOnDate("not-a-date", TODAY)).toBeNull();
  });
});
