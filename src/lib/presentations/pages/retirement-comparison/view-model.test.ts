import { describe, it, expect } from "vitest";
import { buildRetirementComparisonData } from "./view-model";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "./options-schema";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear } from "@/engine/types";

// Minimal ProjectionYear factory (only fields the view-model reads).
function py(year: number, liquid: number, tax: number, clientAge: number): ProjectionYear {
  return {
    year,
    ages: { client: clientAge, spouse: null },
    portfolioAssets: { liquidTotal: liquid, cashTotal: liquid, retirementTotal: 0, taxableTotal: 0 },
    expenses: { taxes: tax },
    income: { total: 0 },
    withdrawals: { total: 0 },
    totalExpenses: 0,
  } as unknown as ProjectionYear;
}

function byYearRow(year: number, p20: number, p50: number, p80: number) {
  return { year, age: { client: 70 }, balance: { p5: 0, p20, p50, p80, p95: 0, min: 0, max: 0 }, cagrFromStart: null };
}

function bundle(years: ProjectionYear[], success: number, maxSpend: number) {
  return {
    clientData: {
      client: { dateOfBirth: "1965-01-01", retirementAge: 65 },
      planSettings: { planStartYear: 2026, inflationRate: 0.0 }, // 0% inflation → flat series
    },
    projection: { years },
    scenarioLabel: "Delay + Roth",
    monteCarlo: { summary: { successRate: success, byYear: years.map((y) => byYearRow(y.year, 100, 200, 300)) } },
    maxSpend: { realAnnualSpend: maxSpend, scaleFactor: 1, achievedPoS: success, status: "converged" },
  } as never;
}

const baseYears = [py(2030, 1_000_000, 50_000, 65), py(2031, -10_000, 40_000, 66)]; // base depletes yr2
const scnYears = [py(2030, 1_200_000, 30_000, 65), py(2031, 900_000, 25_000, 66)]; // scenario funded

const ctx = {
  bundlesByRef: {
    base: bundle(baseYears, 0.73, 90_000),
    "scenario:s1": bundle(scnYears, 0.91, 110_000),
  },
} as unknown as BuildDataContext;

const opts = { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT, scenarioId: "s1" };

describe("buildRetirementComparisonData", () => {
  it("builds the verdict headline from success rates", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.isEmpty).toBe(false);
    expect(d.verdict.headline).toContain("91%");
    expect(d.verdict.headline).toContain("73%");
  });

  it("exposes both plans' max spend (today's $) and a series", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.maxSpend.show).toBe(true);
    expect(d.maxSpend.baseToday).toBe(90_000);
    expect(d.maxSpend.scenarioToday).toBe(110_000);
    expect(d.maxSpend.series.length).toBeGreaterThan(0);
  });

  it("shows tax-saved only when favorable, with the saving", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    // base tax 90k vs scn 55k → favorable.
    expect(d.taxSaved.show).toBe(true);
  });

  it("shows lasts-to-age when the scenario funds longer", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.lastsToAge.show).toBe(true);
  });

  it("always shows legacy", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.legacy.show).toBe(true);
  });
});
