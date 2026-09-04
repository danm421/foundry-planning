import { describe, it, expect } from "vitest";
import {
  normalizeName, namesMatch, differs, deflate, rowAmountInYear, ageAtYearEnd, makeDelta, ROW, W2, SPEND,
} from "../compare";

describe("normalizeName", () => {
  it("lower-cases, strips punctuation and entity suffixes", () => {
    expect(normalizeName("Acme, Inc.")).toBe("acme");
    expect(normalizeName("The Smith Group LLC")).toBe("smith group");
    expect(normalizeName("O'Brien & Sons Co")).toBe("obrien sons");
  });
});

describe("namesMatch", () => {
  it("matches equal, contained (shorter ≥ 4), and near-equal (≥ 6, ≤ 2 edits) names", () => {
    expect(namesMatch("Acme Corp", "ACME")).toBe(true);          // equal after normalizing
    expect(namesMatch("Acme Widgets", "Acme")).toBe(true);        // contains, shorter is 4
    expect(namesMatch("Acme Widgets", "Ace")).toBe(false);        // shorter < 4
    expect(namesMatch("Northwind Traders", "Northwind Tradres")).toBe(true); // 2 edits
    expect(namesMatch("Northwind", "Southwind")).toBe(true);      // 2 edits — inside the rule
    expect(namesMatch("Northwind", "Southland")).toBe(false);     // 4 edits
    expect(namesMatch("Smith", "Smyth")).toBe(false);             // < 6 chars: no fuzzy
    expect(namesMatch(null, "Acme")).toBe(false);
  });
});

describe("differs", () => {
  it("requires the gap to exceed BOTH the percent and the dollar floor (row: 5% / $500)", () => {
    expect(differs(100_000, 96_000, ROW)).toBe(false);   // 4% but $4,000
    expect(differs(8_000, 7_400, ROW)).toBe(true);       // 7.5% AND $600 — both exceeded
    expect(differs(8_000, 7_600, ROW)).toBe(false);      // 5% exactly, $400
    expect(differs(100_000, 94_000, ROW)).toBe(true);    // 6%, $6,000
    expect(differs(1_000, 0, ROW)).toBe(true);           // plan missing
    expect(differs(0, 1_000, ROW)).toBe(true);           // return missing
    expect(differs(null, 1_000, ROW)).toBe(false);       // no return figure → no comparison
  });
  it("uses the wider thresholds by name", () => {
    expect(W2).toEqual({ pct: 0.10, abs: 500 });
    expect(SPEND).toEqual({ pct: 0.10, abs: 10_000 });
  });
});

describe("growth", () => {
  it("deflates by the rate over the year gap and inflates a row to a target year from its own base", () => {
    expect(deflate(103_000, 0.03, 1)).toBeCloseTo(100_000, 6);
    expect(deflate(100_000, 0.03, 0)).toBe(100_000);
    const row = { annualAmount: 100_000, growthRate: 0.03, startYear: 2026, inflationStartYear: 2025 };
    expect(rowAmountInYear(row, 2025)).toBeCloseTo(100_000, 6);   // stated in 2025 dollars
    expect(rowAmountInYear(row, 2026)).toBeCloseTo(103_000, 6);
    expect(rowAmountInYear({ ...row, inflationStartYear: null }, 2025)).toBeCloseTo(100_000 / 1.03, 6);
  });
});

describe("ageAtYearEnd / makeDelta", () => {
  it("ages by birth year and tones the delta from the plan's point of view", () => {
    expect(ageAtYearEnd("1960-06-15", 2025)).toBe(65);
    expect(ageAtYearEnd(null, 2025)).toBeNull();
    expect(makeDelta(10_000, 8_000).tone).toBe("short");
    expect(makeDelta(10_000, 12_000).tone).toBe("over");
    expect(makeDelta(10_000, 0).tone).toBe("missing");
    expect(makeDelta(0, 5_000).tone).toBe("extra");
    expect(makeDelta(null, null)).toEqual({ amount: null, display: "—", tone: "neutral" });
    expect(makeDelta(10_000, 8_000).display).toBe("Plan is $2,000 short");
  });
});
