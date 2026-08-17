import { describe, it, expect } from "vitest";
import { yearOf, addYears, isStrictlyAfter, anniversaryIn, endOfYear } from "../dates";

describe("dates", () => {
  it("reads the year", () => {
    expect(yearOf("2026-02-01")).toBe(2026);
  });

  it("adds whole years and clamps 29 Feb to 28 Feb", () => {
    expect(addYears("2026-02-01", 1)).toBe("2027-02-01");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("is strictly after — equal dates are NOT after", () => {
    expect(isStrictlyAfter("2027-02-02", "2027-02-01")).toBe(true);
    expect(isStrictlyAfter("2027-02-01", "2027-02-01")).toBe(false);
    expect(isStrictlyAfter("2027-01-31", "2027-02-01")).toBe(false);
  });

  it("moves a date to its anniversary in another year", () => {
    expect(anniversaryIn("2026-03-15", 2030)).toBe("2030-03-15");
    expect(anniversaryIn("2024-02-29", 2027)).toBe("2027-02-28");
  });

  it("gives 31 December of a year", () => {
    expect(endOfYear(2030)).toBe("2030-12-31");
  });
});
