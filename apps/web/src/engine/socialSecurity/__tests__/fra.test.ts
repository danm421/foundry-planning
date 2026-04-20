import { describe, it, expect } from "vitest";
import { fraForBirthDate, survivorFraForBirthDate } from "../fra";

describe("fraForBirthDate", () => {
  it("returns 65y 0m for birth year 1937", () => {
    expect(fraForBirthDate("1937-06-15")).toEqual({ years: 65, months: 0, totalMonths: 780 });
  });
  it("returns 66y 4m for birth year 1956", () => {
    expect(fraForBirthDate("1956-08-01")).toEqual({ years: 66, months: 4, totalMonths: 796 });
  });
  it("returns 67y 0m for birth year 1960", () => {
    expect(fraForBirthDate("1960-05-12")).toMatchObject({ years: 67, months: 0 });
  });
  it("returns 67y 0m for birth year 1975 (post-1960 fallback)", () => {
    expect(fraForBirthDate("1975-05-12")).toMatchObject({ years: 67, months: 0 });
  });
  it("returns 65y 0m for birth year 1920 (pre-1937 fallback)", () => {
    expect(fraForBirthDate("1920-01-15")).toMatchObject({ years: 65, months: 0 });
  });
  it("applies the January-1 rule (uses previous birth year's FRA)", () => {
    // Born 1960-01-01 → treat as 1959 → 66y 10m, not 67y 0m
    expect(fraForBirthDate("1960-01-01")).toMatchObject({ years: 66, months: 10 });
  });
  it("does NOT apply Jan-1 rule for Jan 2 or later", () => {
    expect(fraForBirthDate("1960-01-02")).toMatchObject({ years: 67, months: 0 });
  });
});

describe("survivorFraForBirthDate", () => {
  it("returns 66y 0m for birth year 1950", () => {
    expect(survivorFraForBirthDate("1950-03-15")).toMatchObject({ years: 66, months: 0 });
  });
  it("includes monthlyReductionPct precomputed from months 60→FRA", () => {
    const r = survivorFraForBirthDate("1950-03-15");
    // months from 60 to 66 = 72, 0.285 / 72 ≈ 0.003958
    expect(r.monthsFrom60).toBe(72);
    expect(r.monthlyReductionPct).toBeCloseTo(0.003958, 5);
  });
  it("returns 67y 0m for birth year 1962 and beyond", () => {
    expect(survivorFraForBirthDate("1962-07-20")).toMatchObject({ years: 67, months: 0 });
    expect(survivorFraForBirthDate("1990-07-20")).toMatchObject({ years: 67, months: 0 });
  });
  it("applies Jan-1 rule for survivor FRA too", () => {
    // Born 1962-01-01 → treat as 1961 → 66y 10m
    expect(survivorFraForBirthDate("1962-01-01")).toMatchObject({ years: 66, months: 10 });
  });
});
