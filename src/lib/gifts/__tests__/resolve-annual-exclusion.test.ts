import { describe, it, expect } from "vitest";
import {
  resolveAnnualExclusion,
  buildAnnualExclusionMap,
  type TaxYearRow,
} from "../resolve-annual-exclusion";

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

  it("falls back to 19000 (2025/2026 §2503(b)) when rows are empty", () => {
    expect(resolveAnnualExclusion(2030, [], 0.025)).toBe(19_000);
  });

  it("projects from the max year even when rows arrive unsorted", () => {
    const rows: TaxYearRow[] = [row(2025, 19_000), row(2024, 18_000), row(2026, 19_000)];
    expect(resolveAnnualExclusion(2027, rows, 0.025)).toBe(19_000);
  });
});

describe("buildAnnualExclusionMap", () => {
  it("emits a dense map across the horizon: seeded years exact, out-years projected (audit F2)", () => {
    const map = buildAnnualExclusionMap([{ year: 2026, giftAnnualExclusion: 19_000 }], 2026, 2030, 0.025);
    expect(map[2026]).toBe(19_000); // seeded exact
    expect(map[2027]).toBe(19_000); // 19000 * 1.025 → 19475 → 19000
    expect(map[2030]).toBe(21_000); // 19000 * 1.025^4 → 20973 → 21000
    // No year past the last seeded row is left undefined → no silent $0.
    for (let y = 2026; y <= 2030; y++) expect(map[y]).toBeGreaterThan(0);
  });

  it("coerces pg-numeric string values (raw DB / API JSON rows)", () => {
    const map = buildAnnualExclusionMap([{ year: 2026, giftAnnualExclusion: "19000.00" }], 2026, 2027, 0.025);
    expect(map[2026]).toBe(19_000);
    expect(map[2027]).toBe(19_000);
  });

  it("falls back to the statutory $19k across the horizon when no rows are seeded", () => {
    const map = buildAnnualExclusionMap([], 2026, 2028, 0.025);
    expect(map[2026]).toBe(19_000);
    expect(map[2028]).toBe(19_000);
  });
});
