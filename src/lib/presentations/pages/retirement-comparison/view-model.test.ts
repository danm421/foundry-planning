import { describe, it, expect } from "vitest";
import { buildRetirementComparisonData } from "./view-model";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "./options-schema";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear } from "@/engine/types";

// Minimal ProjectionYear factory (only fields the view-model reads).
function py(
  year: number,
  liquid: number,
  tax: number,
  clientAge: number,
  retirement: Record<string, number> = {},
  ledgers: Record<string, { rothValueEoY?: number }> = {},
): ProjectionYear {
  return {
    year,
    ages: { client: clientAge, spouse: null },
    portfolioAssets: {
      liquidTotal: liquid,
      cashTotal: liquid,
      retirementTotal: Object.values(retirement).reduce((s, v) => s + v, 0),
      taxableTotal: 0,
      retirement,
    },
    accountLedgers: ledgers,
    expenses: { taxes: tax },
    income: { total: 0 },
    withdrawals: { total: 0 },
    totalExpenses: 0,
  } as unknown as ProjectionYear;
}

function byYearRow(year: number, p20: number, p50: number, p80: number) {
  return { year, age: { client: 70 }, balance: { p5: 0, p20, p50, p80, p95: 0, min: 0, max: 0 }, cagrFromStart: null };
}

function bundle(
  years: ProjectionYear[],
  success: number,
  maxSpend: number,
  accounts: { id: string; subType: string }[] = [],
  endP20 = 100,
) {
  return {
    clientData: {
      client: { dateOfBirth: "1965-01-01", retirementAge: 65 },
      planSettings: { planStartYear: 2026, inflationRate: 0.0 }, // 0% inflation → flat series
      accounts,
    },
    projection: { years },
    scenarioLabel: "Delay + Roth",
    monteCarlo: {
      summary: {
        successRate: success,
        byYear: years.map((y, i) => byYearRow(y.year, i === years.length - 1 ? endP20 : 100, 200, 300)),
      },
    },
    maxSpend: { realAnnualSpend: maxSpend, scaleFactor: 1, achievedPoS: success, status: "converged" },
  } as never;
}

// Base depletes; scenario funded. Scenario holds a Roth IRA at retirement.
const baseYears = [py(2030, 1_000_000, 50_000, 65), py(2031, 10_000, 40_000, 66)];
const scnYears = [
  py(2030, 1_200_000, 30_000, 65, { r: 400_000, k: 600_000 }, { k: { rothValueEoY: 200_000 } }),
  py(2031, 900_000, 25_000, 66, { r: 500_000 }),
];
const scnAccounts = [
  { id: "r", subType: "roth_ira" },
  { id: "k", subType: "401k" },
];

const ctx = {
  bundlesByRef: {
    base: bundle(baseYears, 0.73, 90_000, [], 1_500_000),
    "scenario:s1": bundle(scnYears, 0.91, 110_000, scnAccounts, 13_900_000),
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

  it("builds the 4 headline KPIs that improve", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    const labels = d.kpis.map((k) => k.label);
    expect(labels).toEqual([
      "Probability of success",
      "Legacy to heirs",
      "Max sustainable spend",
      "Downside ending balance",
    ]);
    const success = d.kpis[0];
    expect(success.base).toBe("73%");
    expect(success.scenario).toBe("91%");
    expect(success.delta).toBe("+18 pts");
    const maxSpend = d.kpis[2];
    expect(maxSpend.base).toBe("$90K/yr");
    expect(maxSpend.scenario).toBe("$110K/yr");
    const downside = d.kpis[3];
    expect(downside.base).toBe("$1.5M");
    expect(downside.scenario).toBe("$13.9M");
  });

  it("splits at-retirement assets by tax treatment for the scenario", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.atRetirement.year).toBe(2030);
    // Scenario 2030: cash 1.2M (liquidTotal), Roth IRA 400k + 401k Roth slice 200k = 600k,
    // pre-tax = 401k remainder 400k.
    expect(d.atRetirement.scenario.cash).toBe(1_200_000);
    expect(d.atRetirement.scenario.roth).toBe(600_000);
    expect(d.atRetirement.scenario.preTax).toBe(400_000);
    expect(d.atRetirement.scenario.hsa).toBe(0);
  });

  it("exposes the end-of-life breakdown for the condensed matrix", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.atEndOfLife.year).toBe(2031);
    expect(d.atEndOfLife.scenario.roth).toBe(500_000);
  });
});
