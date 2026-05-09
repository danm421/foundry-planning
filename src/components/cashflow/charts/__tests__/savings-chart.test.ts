import { describe, it, expect } from "vitest";
import { buildSavingsDatasets } from "../savings-chart";
import { makeYear } from "./fixtures";

describe("buildSavingsDatasets", () => {
  it("groups contributions by account sub-type", () => {
    const accountSubTypes = { a1: "401k", a2: "401k", a3: "ira", a4: "brokerage" };
    const years = [
      makeYear({
        year: 2026,
        savings: {
          byAccount: { a1: 10_000, a2: 5_000, a3: 6_000, a4: 0 },
          total: 21_000,
          employerTotal: 0,
        },
      }),
      makeYear({
        year: 2027,
        savings: {
          byAccount: { a1: 10_000, a3: 6_000, a4: 4_000 },
          total: 20_000,
          employerTotal: 0,
        },
      }),
    ];
    const series = buildSavingsDatasets(years, accountSubTypes);
    const labels = series.map((s) => s.label).sort();
    expect(labels).toEqual(["401k", "Brokerage", "IRA"]);
    const k = series.find((s) => s.label === "401k")!;
    expect(k.valueFor(years[0])).toBe(15_000);
    expect(k.valueFor(years[1])).toBe(10_000);
  });

  it("excludes sub-types that are always zero across all years", () => {
    const accountSubTypes = { a1: "401k", a2: "ira" };
    const years = [
      makeYear({
        year: 2026,
        savings: { byAccount: { a1: 5_000, a2: 0 }, total: 5_000, employerTotal: 0 },
      }),
    ];
    const series = buildSavingsDatasets(years, accountSubTypes);
    expect(series.map((s) => s.label)).toEqual(["401k"]);
  });

  it("buckets accounts whose sub-type is missing under 'Other'", () => {
    const accountSubTypes = { a1: "401k" };
    const years = [
      makeYear({
        year: 2026,
        savings: { byAccount: { a1: 5_000, unknown: 1_000 }, total: 6_000, employerTotal: 0 },
      }),
    ];
    const labels = buildSavingsDatasets(years, accountSubTypes).map((s) => s.label).sort();
    expect(labels).toEqual(["401k", "Other"]);
  });
});
