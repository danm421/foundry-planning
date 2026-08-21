import { describe, it, expect } from "vitest";
import { buildEarlyYearsStandingData } from "../view-model";
import type { EarlyYearsStandingPageOptions } from "../types";
import type { BuildDataContext } from "@/components/presentations/registry";

const OPTS: EarlyYearsStandingPageOptions = { showMatchLine: true, tidbits: [] };

function ctx({
  salary = 120_000,
  contributed = 9_600,
  employer = 3_600,
  year = 2026,
  planStartYear = 2026,
  inflationRate = 0.03,
  portfolioEoy = 84_000,
  portfolioToday = portfolioEoy,
}: {
  salary?: number;
  contributed?: number;
  employer?: number;
  year?: number;
  planStartYear?: number;
  inflationRate?: number;
  portfolioEoy?: number;
  portfolioToday?: number;
} = {}): BuildDataContext {
  const y = {
    year,
    ages: { client: 29 },
    income: { salaries: salary, total: salary },
    savings: { byAccount: {}, total: contributed, employerTotal: employer },
    portfolioAssets: {
      taxable: { brokerage: portfolioEoy },
      liquidTotal: portfolioEoy,
    },
    accountLedgers: {
      brokerage: {
        beginningValue: portfolioToday,
        endingValue: portfolioEoy,
      },
    },
  };
  return {
    years: [y],
    projection: { years: [y] },
    scenarioLabel: "Base Case",
    clientData: {
      client: { firstName: "Jordan" },
      planSettings: { inflationRate, planStartYear },
      savingsRules: [
        {
          id: "r1",
          accountId: "a1",
          annualAmount: 0,
          annualPercent: salary > 0 ? contributed / salary : 0,
          isDeductible: true,
          startYear: 2020,
          endYear: 2060,
        },
      ],
      incomes: [
        {
          id: "i1",
          type: "salary",
          name: "Salary",
          annualAmount: salary,
          startYear: 2020,
          endYear: 2060,
          growthRate: 0.03,
          owner: "client",
        },
      ],
    },
  } as unknown as BuildDataContext;
}

describe("buildEarlyYearsStandingData", () => {
  it("states the savings rate as contributions over salary", () => {
    const d = buildEarlyYearsStandingData(ctx(), OPTS);
    expect(d.savingsRatePct).toBeCloseTo(0.08, 6);
    expect(d.isEmpty).toBe(false);
  });

  it("uses current account balances, not the first projection year's ending balances", () => {
    const d = buildEarlyYearsStandingData(
      ctx({ portfolioToday: 100_000, portfolioEoy: 113_996 }),
      OPTS,
    );

    expect(d.portfolio).toEqual({ today: 100_000, nominal: 100_000 });
  });

  it("names the scenario, age and starting year without duplicating the unit explanation", () => {
    // The page is pinned to Base Case; inside a deck built on some other
    // scenario, the label is the only thing that says so.
    expect(buildEarlyYearsStandingData(ctx(), OPTS).subtitle).toBe(
      "Base Case · At age 29 · Starting year 2026",
    );
  });

  it("reports what the employer actually deposits", () => {
    const d = buildEarlyYearsStandingData(ctx({ employer: 3_600 }), OPTS);
    expect(d.match).toEqual({
      kind: "captured",
      employerAnnual: { today: 3_600, nominal: 3_600 },
    });
  });

  it("omits the match line when the plan has no employer match at all", () => {
    const d = buildEarlyYearsStandingData(ctx({ employer: 0 }), OPTS);
    expect(d.match).toEqual({ kind: "none" });
  });

  it("omits the match line when the advisor turned it off", () => {
    const d = buildEarlyYearsStandingData(ctx(), { ...OPTS, showMatchLine: false });
    expect(d.match).toEqual({ kind: "none" });
  });

  it("renders the advisor's picked tidbits with this household's tokens resolved", () => {
    const d = buildEarlyYearsStandingData(ctx(), { ...OPTS, tidbits: ["compounding-runway"] });
    expect(d.tidbits).toHaveLength(1);
    expect(d.tidbits[0].body).toContain("Jordan");
    expect(d.tidbits[0].body).not.toContain("{{");
  });

  it("reports no tidbits when the advisor picked none", () => {
    expect(buildEarlyYearsStandingData(ctx(), OPTS).tidbits).toEqual([]);
  });

  it("marks the page empty rather than printing a 0% rate with no salary to divide by", () => {
    const d = buildEarlyYearsStandingData(ctx({ salary: 0, contributed: 9_600 }), OPTS);
    expect(d.isEmpty).toBe(true);
    expect(d.savingsRatePct).toBe(0);
  });

  it("deflates dollar figures to the plan's start-year purchasing power", () => {
    const d = buildEarlyYearsStandingData(
      ctx({ year: 2028, planStartYear: 2026, inflationRate: 0.03 }),
      OPTS,
    );
    expect(d.portfolio.today).toBeCloseTo(79_178.06, 2);
    expect(d.portfolio.nominal).toBe(84_000);
    expect(d.grossAnnual.today).toBeCloseTo(113_111.51, 2);
    expect(d.grossAnnual.nominal).toBe(120_000);
    // A ratio is unit-free — deflating both sides must not move it.
    expect(d.savingsRatePct).toBeCloseTo(0.08, 6);
  });
});
