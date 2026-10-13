// src/lib/fact-finder/placement/__tests__/translate.test.ts
import { describe, expect, it } from "vitest";
import {
  monthNumber,
  monthsBetween,
  monthYearParts,
  parseShares,
  splitPersonName,
  termMonthsFromYears,
  toFraction,
  yesNo,
} from "../translate";

describe("toFraction", () => {
  it.each([
    [6.5, 0.065],
    [4.35, 0.0435],
    [0.25, 0.0025],
    [100, 1],
    [7, 0.07],
    [1.1, 0.011], // 1.1 / 100 is 0.011000000000000001
    [14.3, 0.143], // 14.3 / 100 is 0.14300000000000002
    [0, 0],
  ])("toFraction(%s) is exactly %s", (percent, fraction) => {
    expect(toFraction(percent)).toBe(fraction);
  });
});

describe("months and years", () => {
  it("reads a month name as its number", () => {
    expect(monthNumber("March")).toBe(3);
    expect(monthNumber("December")).toBe(12);
    expect(monthNumber("Mar")).toBeNull();
    expect(monthNumber("")).toBeNull();
  });

  it("splits a month-year or an ISO date", () => {
    expect(monthYearParts("2026-03")).toEqual({ month: 3, year: 2026 });
    expect(monthYearParts("2026-03-15")).toEqual({ month: 3, year: 2026 });
    expect(monthYearParts("2026-13")).toBeNull();
    expect(monthYearParts("March 2026")).toBeNull();
  });

  it("counts whole months from one to the other", () => {
    expect(monthsBetween("2020-01", "2050-01")).toBe(360);
    expect(monthsBetween("2024-03-15", "2025-01")).toBe(10);
    expect(monthsBetween("2025-01", "2024-01")).toBe(-12);
    expect(monthsBetween("soon", "2025-01")).toBeNull();
  });

  it("turns a term in years into months", () => {
    expect(termMonthsFromYears(30)).toBe(360);
    expect(termMonthsFromYears(2.5)).toBe(30);
  });

  it("reads Yes / No", () => {
    expect(yesNo("Yes")).toBe(true);
    expect(yesNo("No")).toBe(false);
    expect(yesNo("Maybe")).toBeNull();
  });
});

describe("splitPersonName", () => {
  it("takes the last word as the last name", () => {
    expect(splitPersonName("Jane Q. Smith")).toEqual({ firstName: "Jane Q.", lastName: "Smith" });
    expect(splitPersonName("  Jane   Smith ")).toEqual({ firstName: "Jane", lastName: "Smith" });
  });

  it("gives up on one word or none", () => {
    expect(splitPersonName("Cher")).toBeNull();
    expect(splitPersonName("  ")).toBeNull();
  });
});

describe("parseShares", () => {
  it("reads names with their percents, either side of the name", () => {
    const parts = [{ name: "Emma", percent: 50 }, { name: "Lucas", percent: 50 }];
    expect(parseShares("Emma 50%, Lucas 50%")).toEqual({ ok: true, parts });
    expect(parseShares("50% Emma; 50% Lucas")).toEqual({ ok: true, parts });
    expect(parseShares("Emma 50 %\nLucas 50%")).toEqual({ ok: true, parts });
  });

  it("splits evenly when no name has a share", () => {
    const halves = { ok: true, parts: [{ name: "Emma", percent: 50 }, { name: "Lucas", percent: 50 }] };
    expect(parseShares("Emma and Lucas")).toEqual(halves);
    expect(parseShares("Emma / Lucas")).toEqual(halves);
    expect(parseShares("Emma & Lucas in equal shares")).toEqual(halves);
    expect(parseShares("Emma, Lucas, evenly")).toEqual(halves);
  });

  it("gives the last name the rounding of a three-way split", () => {
    expect(parseShares("Emma, Lucas and Noah equally")).toEqual({
      ok: true,
      parts: [
        { name: "Emma", percent: 33.33 },
        { name: "Lucas", percent: 33.33 },
        { name: "Noah", percent: 33.34 },
      ],
    });
  });

  it("gives a lone name everything", () => {
    expect(parseShares("Emma Hendricks")).toEqual({ ok: true, parts: [{ name: "Emma Hendricks", percent: 100 }] });
  });

  it("accepts shares within a hundredth of 100", () => {
    expect(parseShares("Emma 33.33%, Lucas 33.33%, Noah 33.33%")).toMatchObject({ ok: true });
  });

  it("refuses shares that don't add up to 100", () => {
    expect(parseShares("Emma 50%, Lucas 40%")).toEqual({ ok: false, reason: "Shares add up to 90%, not 100%." });
    expect(parseShares("Emma 33.3%, Lucas 33.3%, Noah 33.3%")).toEqual({
      ok: false,
      reason: "Shares add up to 99.9%, not 100%.",
    });
  });

  it("refuses a mix of names with and without shares", () => {
    expect(parseShares("Emma 60%, Lucas")).toEqual({ ok: false, reason: "Give every name a share, or none." });
  });

  it("refuses a share with no name", () => {
    expect(parseShares("50%, Lucas 50%")).toEqual({ ok: false, reason: 'Each share needs a name, like "Emma 50%".' });
  });

  it("refuses nothing at all", () => {
    expect(parseShares("  ")).toEqual({ ok: false, reason: "No names given." });
    expect(parseShares("equally")).toEqual({ ok: false, reason: "No names given." });
  });
});
