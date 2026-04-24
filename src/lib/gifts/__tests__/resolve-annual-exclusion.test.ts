import { describe, it, expect } from "vitest";
import { resolveAnnualExclusion, type TaxYearRow } from "../resolve-annual-exclusion";

const row = (year: number, value: number): TaxYearRow => ({
  year,
  giftAnnualExclusion: value,
});

describe("resolveAnnualExclusion", () => {
  it("returns the seeded value when the year is present", () => {
    const rows: TaxYearRow[] = [row(2024, 18_000), row(2025, 19_000), row(2026, 19_000)];
    expect(resolveAnnualExclusion(2025, rows, 0.025)).toBe(19_000);
  });

  it("projects forward from latest year, rounds to nearest 1000", () => {
    const rows: TaxYearRow[] = [row(2024, 18_000), row(2025, 19_000), row(2026, 19_000)];
    expect(resolveAnnualExclusion(2027, rows, 0.025)).toBe(19_000);
    expect(resolveAnnualExclusion(2028, rows, 0.025)).toBe(20_000);
    expect(resolveAnnualExclusion(2036, rows, 0.025)).toBe(24_000);
  });

  it("falls back to 18000 when rows are empty", () => {
    expect(resolveAnnualExclusion(2030, [], 0.025)).toBe(18_000);
  });

  it("projects from the max year even when rows arrive unsorted", () => {
    const rows: TaxYearRow[] = [row(2025, 19_000), row(2024, 18_000), row(2026, 19_000)];
    expect(resolveAnnualExclusion(2027, rows, 0.025)).toBe(19_000);
  });
});
