import { describe, it, expect } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { dataLight } from "@/brand";
import { yearWithdrawalRate } from "@/lib/solver/withdrawal-report";
import { buildSolverCashFlowData, resolveSolverCashFlowYear } from "../view-model";
import { solverCashFlowOptionsSchema } from "../options-schema";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

interface YearSpec {
  year: number;
  socialSecurity?: number;
  rentals?: number;
  withdrawals?: Record<string, number>;
  living?: number;
  mortgages?: Record<string, number>;
  taxes?: number;
  liquid?: number;
}

/** Only what the year breakdown, the chart and Withdrawal % read. */
function makeYear(spec: YearSpec): ProjectionYear {
  const socialSecurity = spec.socialSecurity ?? 0;
  const rentals = spec.rentals ?? 0;
  const withdrawals = spec.withdrawals ?? {};
  const mortgages = spec.mortgages ?? {};
  const living = spec.living ?? 0;
  const taxes = spec.taxes ?? 0;
  const liabilities = Object.values(mortgages).reduce((s, v) => s + v, 0);
  const totalIncome = socialSecurity + rentals;
  const totalExpenses = living + liabilities + taxes;
  const bySource: Record<string, number> = {};
  if (socialSecurity) bySource["inc-ss"] = socialSecurity;
  if (rentals) bySource["inc-rent"] = rentals;
  return {
    year: spec.year,
    ages: { client: spec.year - 1967, spouse: spec.year - 1964 },
    income: {
      salaries: 0, socialSecurity, business: 0, trust: 0, deferred: 0,
      capitalGains: 0, other: rentals, total: totalIncome, bySource,
    },
    withdrawals: {
      byAccount: withdrawals,
      total: Object.values(withdrawals).reduce((s, v) => s + v, 0),
    },
    expenses: {
      living, taxes, liabilities, other: 0, insurance: 0, realEstate: 0,
      cashGifts: 0, discretionary: 0, total: totalExpenses,
      bySource: living ? { "exp-living": living } : {},
      byLiability: mortgages, interestByLiability: {},
    },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    totalIncome,
    totalExpenses,
    netCashFlow: totalIncome - totalExpenses,
    accountLedgers: {},
    portfolioAssets: { taxableTotal: spec.liquid ?? 0, cashTotal: 0, retirementTotal: 0, liquidTotal: spec.liquid ?? 0 },
  } as unknown as ProjectionYear;
}

function clientData(liabilityCount = 1): ClientData {
  const base = makeClientData();
  const owners = [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }];
  return {
    ...base,
    accounts: [
      { id: "acc-schwab", name: "Schwab HY", category: "taxable", owners },
      { id: "acc-cash", name: "Cash", category: "cash", owners },
    ],
    incomes: [
      { id: "inc-ss", name: "Social Security — David", type: "social_security" },
      { id: "inc-rent", name: "Rentals", type: "other" },
    ],
    expenses: [{ id: "exp-living", name: "Living Expenses", type: "living" }],
    liabilities: Array.from({ length: liabilityCount }, (_, i) => ({
      id: `liab-${i}`,
      name: `Mortgage ${i}`,
    })),
  } as unknown as ClientData;
}

function mortgages(count: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`liab-${i}`, 1_000]));
}

/** 2026 draws on the portfolio; 2027 doesn't. */
const YEARS = [
  makeYear({
    year: 2026,
    socialSecurity: 22_742,
    rentals: 66_300,
    withdrawals: { "acc-schwab": 9_952, "acc-cash": 17_306 },
    living: 64_000,
    mortgages: { "liab-0": 10_466 },
    taxes: 34_800,
    liquid: 1_627_541,
  }),
  makeYear({ year: 2027, socialSecurity: 50_000, rentals: 66_300, living: 64_000, taxes: 30_000, liquid: 1_650_000 }),
];

function build(year: number | null = null, data = clientData(), years = YEARS) {
  return buildSolverCashFlowData({
    years,
    clientData: data,
    options: { year },
    scenarioLabel: "Base Case",
    clientName: "Jennifer",
    spouseName: "David",
  });
}

describe("resolveSolverCashFlowYear", () => {
  it("opens on the first plan year, like the Solver, and clamps a stale year into the plan", () => {
    expect(resolveSolverCashFlowYear(YEARS, null)).toBe(2026);
    expect(resolveSolverCashFlowYear(YEARS, 2027)).toBe(2027);
    expect(resolveSolverCashFlowYear(YEARS, 2019)).toBe(2026);
    expect(resolveSolverCashFlowYear(YEARS, 2099)).toBe(2027);
    expect(resolveSolverCashFlowYear([], 2030)).toBeNull();
  });
});

describe("solverCashFlowOptionsSchema", () => {
  it("reads a deck saved with the page's earlier range options as the first plan year", () => {
    expect(solverCashFlowOptionsSchema.parse({ range: "full", showCallout: false })).toEqual({ year: null });
  });
});

describe("buildSolverCashFlowData", () => {
  it("prints the year panel's breakdown: inflows before withdrawals, withdrawals on their own", () => {
    const data = build();
    expect(data.title).toBe("Solver - Cash Flow");
    expect(data.subtitle).toBe("Base Case");
    expect(data.year).toBe(2026);
    expect(data.ageLabel).toBe("Age 59 / 62");
    expect(data.inflows.map((c) => [c.label, c.total])).toEqual([
      ["Social Security", 22_742],
      ["Other Inflows", 66_300],
    ]);
    expect(data.withdrawals!.label).toBe("Portfolio Withdrawals");
    expect(data.withdrawals!.items.map((i) => [i.label, i.amount])).toEqual([
      ["Schwab HY", 9_952],
      ["Cash", 17_306],
    ]);
    expect(data.outflows.map((c) => [c.label, c.total])).toEqual([
      ["Living Expenses", 64_000],
      ["Liabilities", 10_466],
      ["Taxes", 34_800],
    ]);
    expect(data.totals).toEqual({
      inflows: 89_042,
      outflows: 109_266,
      net: -20_224,
      endingPortfolio: 1_627_541,
    });
  });

  it("colors each inflow like its bar and leaves outflows neutral", () => {
    const data = build();
    expect(data.inflows.map((c) => c.color)).toEqual([dataLight.blue, dataLight.teal]);
    expect(data.withdrawals!.color).toBe(dataLight.yellow);
    expect(data.outflows.every((c) => c.color === null)).toBe(true);
  });

  it("prints the screen's Withdrawal %, and none in a year nothing is drawn", () => {
    expect(build(2026).withdrawalRate).toBe(yearWithdrawalRate(YEARS[0], YEARS, clientData().accounts));
    expect(build(2027).withdrawalRate).toBe(0);
    expect(build(2027).withdrawals).toBeNull();
  });

  it("outlines the chosen year on the chart", () => {
    const { chartSpec } = build(2027);
    expect(chartSpec!.highlightX).toBe(2027);
    expect(chartSpec!.xAxis.domain).toEqual([2026, 2027]);
    expect(chartSpec!.stacks.map((s) => s.label)).toEqual(["Social Security", "Other Inflows", "Withdrawals"]);
    expect(chartSpec!.lines.map((l) => l.label)).toEqual(["Total Out"]);
  });

  it("drops the chart, then the line items, before the breakdown outgrows the sheet", () => {
    const withLiabilities = (count: number) =>
      build(2026, clientData(count), [makeYear({ year: 2026, living: 64_000, mortgages: mortgages(count) })]);

    const fitsUnderChart = withLiabilities(10);
    expect(fitsUnderChart.chartSpec).not.toBeNull();
    expect(fitsUnderChart.outflows[1].items).toHaveLength(10);

    const ownSheet = withLiabilities(25);
    expect(ownSheet.chartSpec).toBeNull();
    expect(ownSheet.outflows[1].items).toHaveLength(25);

    const totalsOnly = withLiabilities(45);
    expect(totalsOnly.chartSpec).toBeNull();
    expect(totalsOnly.outflows[1].items).toEqual([]);
    expect(totalsOnly.outflows[1].total).toBe(45_000);
  });

  it("says so when the projection has no years", () => {
    const data = build(null, clientData(), []);
    expect(data.year).toBeNull();
    expect(data.chartSpec).toBeNull();
  });
});
