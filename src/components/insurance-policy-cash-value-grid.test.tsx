import { describe, it, expect } from "vitest";
import {
  parseScheduleCsv,
  buildScheduleCsvTemplate,
  buildRangeRows,
} from "./insurance-policy-cash-value-grid";

describe("cash value schedule CSV", () => {
  it("template round-trips through the parser with matching column order", () => {
    const rows = parseScheduleCsv(buildScheduleCsvTemplate());
    expect(rows.length).toBeGreaterThan(0);
    // Year,Premium,Income,Cash Value,Death Benefit — the parser must read
    // the template's columns back into the right fields.
    expect(rows[0]).toMatchObject({
      year: 2025,
      premiumAmount: 12000,
      cashValue: 250000,
      deathBenefit: 500000,
    });
    // Blank cells (Income here) parse to undefined, not 0.
    expect(rows[0].income).toBeUndefined();
  });

  it("template starts with the expected header row", () => {
    expect(buildScheduleCsvTemplate().split(/\r?\n/)[0]).toBe(
      "Year,Premium,Income,Cash Value,Death Benefit",
    );
  });
});

describe("buildRangeRows", () => {
  it("renders every year in the range, merging saved values by year", () => {
    const rows = buildRangeRows(2026, 2029, [
      { year: 2027, cashValue: 1000, premiumAmount: 500 },
    ]);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029]);
    // Saved value lands on its matching year.
    expect(rows[1]).toMatchObject({ year: 2027, cashValue: 1000, premiumAmount: 500 });
    // Other years are blank.
    expect(rows[0].cashValue).toBeUndefined();
    expect(rows[3].premiumAmount).toBeUndefined();
  });

  it("drops saved years outside the range", () => {
    const rows = buildRangeRows(2026, 2027, [
      { year: 2020, cashValue: 99 },
      { year: 2031, cashValue: 88 },
      { year: 2026, cashValue: 7 },
    ]);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027]);
    expect(rows[0].cashValue).toBe(7);
  });

  it("returns no rows for a degenerate or non-finite range", () => {
    expect(buildRangeRows(2030, 2026, [])).toEqual([]);
    expect(buildRangeRows(NaN, 2026, [])).toEqual([]);
  });
});
