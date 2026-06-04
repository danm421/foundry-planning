import { describe, it, expect } from "vitest";
import {
  parseScheduleCsv,
  buildScheduleCsvTemplate,
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
