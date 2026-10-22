import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { buildSolverCashFlowData } from "../view-model";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

interface YearSpec {
  year: number;
  salaries?: number;
  socialSecurity?: number;
  withdrawals?: number;
  living?: number;
  taxes?: number;
  savings?: number;
  liquid?: number;
}

/** Only what `yearCashFlow` and `liquidPortfolioTotal` read. No RMDs and no
 *  other expenses, so those two columns stay $0 in every year. */
function makeYear(spec: YearSpec): ProjectionYear {
  const salaries = spec.salaries ?? 0;
  const socialSecurity = spec.socialSecurity ?? 0;
  const living = spec.living ?? 0;
  const taxes = spec.taxes ?? 0;
  const savings = spec.savings ?? 0;
  const totalIncome = salaries + socialSecurity;
  return {
    year: spec.year,
    ages: { client: spec.year - 1966, spouse: spec.year - 1970 },
    income: {
      salaries, socialSecurity, business: 0, trust: 0, deferred: 0,
      capitalGains: 0, other: 0, total: totalIncome, bySource: {},
    },
    withdrawals: { byAccount: {}, total: spec.withdrawals ?? 0 },
    expenses: {
      living, taxes, liabilities: 0, other: 0, insurance: 0, realEstate: 0,
      cashGifts: 0, discretionary: 0, total: living + taxes,
      bySource: {}, byLiability: {}, interestByLiability: {},
    },
    savings: { byAccount: {}, total: savings, employerTotal: 0 },
    totalIncome,
    totalExpenses: living + taxes + savings,
    accountLedgers: {},
    portfolioAssets: { taxableTotal: spec.liquid ?? 0, cashTotal: 0, retirementTotal: 0 },
  } as unknown as ProjectionYear;
}

/** Working in 2030, retired in 2031 (no salary, no savings), short in 2032. */
const YEARS = [
  makeYear({ year: 2030, salaries: 200_000, living: 120_000, taxes: 40_000, savings: 30_000, liquid: 1_000_000 }),
  makeYear({ year: 2031, socialSecurity: 50_000, withdrawals: 79_999.7, living: 100_000, taxes: 30_000, liquid: 950_000 }),
  makeYear({ year: 2032, socialSecurity: 52_000, withdrawals: 20_000, living: 100_000, taxes: 32_000, liquid: 0 }),
];

function build(range: "full" | { startYear: number; endYear: number } = "full") {
  return buildSolverCashFlowData({
    years: YEARS,
    clientData: makeClientData(),
    options: { range, showCallout: false },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });
}

describe("buildSolverCashFlowData", () => {
  it("prints the Solver's columns, dropping ones that are $0 every year", () => {
    const data = build();
    expect(data.title).toBe("Solver - Cash Flow");
    expect(data.subtitle).toBe("Base Case");
    expect(data.table.columns.map((c) => c.key)).toEqual([
      "socialSecurity",
      "salaries",
      "withdrawals",
      "totalIn",
      "livingExpenses",
      "taxes",
      "savings",
      "totalOut",
      "net",
      "portfolioAssets",
    ]);
  });

  it("decides the columns over the whole plan, not the printed range", () => {
    // 2032 alone has no salary, but the plan does — the column stays.
    const data = build({ startYear: 2032, endYear: 2032 });
    expect(data.table.rows.map((r) => r.year)).toEqual([2032]);
    expect(data.table.columns.map((c) => c.key)).toContain("salaries");
    expect(data.table.rows[0].cells.salaries).toBe(0);
  });

  it("ties every row out: Total In − Total Out = Surplus / (Shortfall)", () => {
    const [working, , short] = build().table.rows;
    expect(working.cells).toMatchObject({ totalIn: 200_000, totalOut: 190_000, net: 10_000 });
    expect(short.cells).toMatchObject({ totalIn: 72_000, totalOut: 132_000, net: -60_000 });
  });

  it("rounds a break-even year's float residue to $0, not a shortfall", () => {
    const breakEven = build().table.rows[1];
    expect(breakEven.cells.net).toBe(0);
  });

  it("marks only the net and the portfolio red when negative, and bolds the totals", () => {
    const cols = build().table.columns;
    expect(cols.filter((c) => c.critWhenNegative).map((c) => c.key)).toEqual(["net", "portfolioAssets"]);
    expect(cols.filter((c) => c.strong).map((c) => c.key)).toEqual(["totalIn", "totalOut", "net"]);
    expect(cols.some((c) => c.signColor)).toBe(false);
  });

  it("stacks the income columns under a Total Out line, so each bar tops out at Total In", () => {
    const { chartSpec } = build();
    expect(chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "cf:socialSecurity",
      "cf:salaries",
      "cf:withdrawals",
    ]);
    expect(chartSpec!.lines.map((l) => l.seriesId)).toEqual(["totalOut"]);
  });
});
