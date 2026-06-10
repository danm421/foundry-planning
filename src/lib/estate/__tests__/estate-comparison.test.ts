import { describe, it, expect } from "vitest";
import {
  pickRowForYear,
  bucketsFromRow,
  diffBuckets,
} from "../estate-comparison";
import type { YearlyEstateRow } from "../yearly-estate-report";

function row(year: number, over: Partial<YearlyEstateRow> = {}): YearlyEstateRow {
  return {
    year,
    ageClient: null,
    ageSpouse: null,
    grossEstate: 0,
    taxesAndExpenses: 0,
    charitableBequests: 0,
    netToHeirs: 0,
    heirsAssets: 0,
    totalToHeirs: 0,
    charity: 0,
    deaths: [],
    ...over,
  };
}

describe("pickRowForYear", () => {
  const rows = [row(2030), row(2040), row(2050)];

  it("returns the exact-year row when present", () => {
    expect(pickRowForYear(rows, 2040)?.year).toBe(2040);
  });

  it("clamps to the nearest row at or before the year", () => {
    expect(pickRowForYear(rows, 2045)?.year).toBe(2040);
  });

  it("returns the first row when the year precedes all rows", () => {
    expect(pickRowForYear(rows, 2025)?.year).toBe(2030);
  });

  it("returns null for an empty report", () => {
    expect(pickRowForYear([], 2040)).toBeNull();
  });
});

describe("bucketsFromRow", () => {
  it("maps report fields to chart buckets", () => {
    const r = row(2050, {
      totalToHeirs: 10_100_000,
      taxesAndExpenses: 1_300_000,
      charity: 900_000,
    });
    expect(bucketsFromRow(r)).toEqual({
      toHeirs: 10_100_000,
      taxesAndExpenses: 1_300_000,
      toCharity: 900_000,
    });
  });
});

describe("diffBuckets", () => {
  it("computes proposed minus base per bucket", () => {
    const base = { toHeirs: 8_200_000, taxesAndExpenses: 3_400_000, toCharity: 200_000 };
    const proposed = { toHeirs: 10_100_000, taxesAndExpenses: 1_300_000, toCharity: 900_000 };
    expect(diffBuckets(base, proposed)).toEqual({
      toHeirs: 1_900_000,
      taxesAndExpenses: -2_100_000,
      toCharity: 700_000,
    });
  });
});
