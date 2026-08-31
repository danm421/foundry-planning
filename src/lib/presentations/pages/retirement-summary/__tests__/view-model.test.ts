import { describe, it, expect } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import { buildRetirementSummaryData } from "../view-model";
import { RETIREMENT_SUMMARY_OPTIONS_DEFAULT } from "../options-schema";

function ctx(over: Partial<BuildDataContext>): BuildDataContext {
  return {
    years: [],
    projection: {} as never,
    clientData: {
      client: { dateOfBirth: "1966-01-01", retirementAge: 65, spouseDob: null, spouseRetirementAge: null },
      clientName: "John Doe", spouseName: null,
      accounts: [], incomes: [], expenses: [],
      planSettings: {},
    } as never,
    scenarioLabel: "Base",
    clientName: "John Doe", spouseName: null,
    firmName: "Acme", firmTagline: null, reportDate: "2026-06-02",
    firmLogoDataUrl: null, accentColor: "#b87f1f",
    monteCarlo: null,
    ...over,
  } as unknown as BuildDataContext;
}

// Full-enough ProjectionYear for both the retirement-summary aggregates and the
// reused cash-flow row builder. Client DOB in `ctx` is 1966-01-01.
function makeYear(year: number, over: Record<string, unknown> = {}) {
  return {
    year,
    ages: { client: year - 1966, spouse: null },
    portfolioAssets: {
      liquidTotal: 1000, cashTotal: 100, taxableTotal: 500, retirementTotal: 400,
      cash: {}, taxable: {}, retirement: {},
    },
    accountLedgers: {},
    income: {
      salaries: 0, socialSecurity: 40000, business: 0, deferred: 0,
      capitalGains: 0, trust: 0, other: 0, total: 40000, bySource: {},
    },
    withdrawals: { byAccount: {}, total: 20000 },
    expenses: { living: 50000, insurance: 0, realEstate: 0, liabilities: 0, other: 0, total: 50000 },
    savings: { total: 0 },
    totalIncome: 40000,
    totalExpenses: 50000,
    netCashFlow: -10000,
    ...over,
  };
}

describe("buildRetirementSummaryData", () => {
  it("is empty when there are no projection years", () => {
    const data = buildRetirementSummaryData(ctx({}), RETIREMENT_SUMMARY_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(true);
    expect(data.title).toBe("Retirement Summary");
  });

  it("flags married when a spouse SS income exists / spouse present", () => {
    const data = buildRetirementSummaryData(
      ctx({
        years: [makeYear(2031, { portfolioAssets: { liquidTotal: 1, cashTotal: 0, taxableTotal: 0, retirementTotal: 0, cash: {}, taxable: {}, retirement: {} } })] as never,
        spouseName: "Jane Doe",
      }),
      RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(false);
    expect(data.isMarried).toBe(true);
  });

  it("surfaces the Monte Carlo success rate as a KPI string when present", () => {
    const data = buildRetirementSummaryData(
      ctx({
        years: [makeYear(2031, { portfolioAssets: { liquidTotal: 100, cashTotal: 0, taxableTotal: 0, retirementTotal: 0, cash: {}, taxable: {}, retirement: {} } })] as never,
        monteCarlo: { summary: { successRate: 0.9 } } as never,
      }),
      RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
    );
    expect(data.kpis.monteCarlo).toBe("90%");
  });

  it("builds a retirement-sliced cash-flow chart spec for page 2", () => {
    const data = buildRetirementSummaryData(
      ctx({ years: [2029, 2030, 2031, 2032, 2033].map((y) => makeYear(y)) as never }),
      RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
    );
    const spec = data.cashFlowChartSpec;

    // Sliced to earliest retirement year (1966 + 65 = 2031): pre-retirement years dropped.
    expect(spec.xAxis.domain[0]).toBe(2031);
    expect(spec.xAxis.domain).not.toContain(2030);

    // Five income bands + the Total Expenses overlay line.
    expect(spec.stacks.map((s) => s.label)).toEqual([
      "Social Security", "Salaries", "Other Inflows", "RMDs", "Withdrawals",
    ]);
    expect(spec.lines).toHaveLength(1);
    expect(spec.lines[0].label).toBe("Total Expenses");

    // Width + height overrides applied so it fits the portrait page-2 panel.
    expect(spec.width).toBe(500);
    expect(spec.height).toBe(194);

    // Endpoint markers (retirement-start, end-of-life) are stripped: on the sliced
    // chart they sit on the domain edges and clip.
    expect(spec.markers.some((m) => m.iconKind === "retirement" || m.iconKind === "endOfLife")).toBe(false);
  });
});

describe("buildRetirementSummaryData — the funding bar and the narrative share one denominator", () => {
  // Retirement year 2031 (DOB 1966 + age 65). SS 40k, RMD 60k, no withdrawals,
  // 50k of expenses — an over-funded year, so the raw inflow (100k) is twice
  // the cost of retirement.
  const overFunded = (year: number) =>
    makeYear(year, {
      income: {
        salaries: 0, socialSecurity: 40000, business: 0, deferred: 0,
        capitalGains: 0, trust: 0, other: 0, total: 40000, bySource: {},
      },
      accountLedgers: { ira1: { rmdAmount: 60000, endingValue: 0 } },
      withdrawals: { byAccount: {}, total: 0 },
      totalExpenses: 50000,
    });

  it("does not let the funding bar total more than the cost of retirement", () => {
    const data = buildRetirementSummaryData(
      ctx({ years: [overFunded(2031), overFunded(2032)] as never }),
      RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
    );
    const barTotal = data.fundingSources.reduce((s, r) => s + r.value, 0);
    expect(barTotal).toBe(data.funding.totalSpending);
    expect(data.funding.reinvestedSurplus).toBe(100_000);
  });

  it("prints the same percentage for the dominant source as the bar segment shows", () => {
    // A year with a shortfall: 40k SS against 100k of expenses. The bar used to
    // divide by the sum of its segments while the narrative divided by total
    // spending — one page, two answers for one number.
    const short = makeYear(2031, {
      income: {
        salaries: 0, socialSecurity: 40000, business: 0, deferred: 0,
        capitalGains: 0, trust: 0, other: 0, total: 40000, bySource: {},
      },
      accountLedgers: {},
      withdrawals: { byAccount: {}, total: 0 },
      totalExpenses: 100000,
    });
    const data = buildRetirementSummaryData(
      ctx({ years: [short] as never }),
      RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
    );
    const barTotal = data.fundingSources.reduce((s, r) => s + r.value, 0);
    const ss = data.fundingSources.find((r) => r.label === "Social Security")!;
    // The funding takeaway captions the funding bar (sheet two), so it lives
    // in `fundingNarrative`, not the outlook takeaways on sheet one.
    const narrativeLine = data.fundingNarrative.find((l) => l.includes("largest funding source"))!;
    expect(narrativeLine).toContain(`${Math.round((ss.value / barTotal) * 100)}%`);
    expect(narrativeLine).toContain("40%");
    // The unfunded remainder is a segment, so the bar accounts for the whole cost.
    expect(barTotal).toBe(100_000);
    expect(data.fundingSources.some((r) => r.label === "Unfunded" && r.value === 60_000)).toBe(true);
  });
});
