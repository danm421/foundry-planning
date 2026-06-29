import { describe, it, expect } from "vitest";
import { buildCashFlowYearDetail } from "../cashflow-year-detail";
import type { ClientData, ProjectionYear } from "@/engine";

// Minimal ProjectionYear factory — only the fields the helper reads.
function makeYear(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  return {
    year: 2034,
    ages: { client: 67, spouse: 65 },
    income: {
      salaries: 0, socialSecurity: 40_000, business: 0, trust: 0, deferred: 0,
      capitalGains: 0, other: 0, total: 70_000,
      bySource: { "inc-ss": 40_000, "inc-pen": 30_000 },
    },
    withdrawals: { byAccount: { "acc-brokerage": 20_000 }, total: 20_000 },
    accountLedgers: {
      "acc-ira": { rmdAmount: 15_000 } as never,
      "acc-brokerage": { rmdAmount: 0 } as never,
    },
    expenses: {
      living: 60_000, liabilities: 12_000, other: 5_000, insurance: 3_000,
      realEstate: 4_000, taxes: 9_000, cashGifts: 0, discretionary: 0,
      total: 93_000,
      bySource: { "exp-mortgage-ins": 3_000, "exp-misc": 5_000 },
      byLiability: { "liab-mortgage": 12_000 },
      interestByLiability: { "liab-mortgage": 7_000 },
    },
    savings: { byAccount: { "acc-401k": 10_000 }, total: 10_000, employerTotal: 0 },
    totalIncome: 120_000,
    totalExpenses: 103_000,
    netCashFlow: 17_000,
    portfolioAssets: {
      taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {},
      lifeInsurance: {}, stockOptions: {}, taxableTotal: 0, cashTotal: 0,
      retirementTotal: 0, realEstateTotal: 0, businessTotal: 0,
      lifeInsuranceTotal: 0, stockOptionsTotal: 0, trustsAndBusinesses: {},
      trustsAndBusinessesTotal: 0, accessibleTrustAssets: {},
      accessibleTrustAssetsTotal: 0, total: 1_000_000, liquidTotal: 800_000,
    },
    ...overrides,
  } as ProjectionYear;
}

function makeClientData(): ClientData {
  return {
    client: { firstName: "A", lastName: "B" },
    incomes: [
      { id: "inc-ss", name: "Social Security", type: "social_security" },
      { id: "inc-pen", name: "Pension", type: "deferred" },
    ],
    entities: [],
    accounts: [
      { id: "acc-ira", name: "Traditional IRA", category: "retirement" },
      { id: "acc-brokerage", name: "Joint Brokerage", category: "taxable" },
      { id: "acc-401k", name: "401(k)", category: "retirement" },
    ],
    liabilities: [{ id: "liab-mortgage", name: "Home Mortgage" }],
    expenses: [
      { id: "exp-misc", name: "Misc", type: "other" },
      { id: "exp-mortgage-ins", name: "Life Policy Premium", type: "insurance" },
    ],
    assetTransactions: [],
    stockOptionPlans: [],
    notesReceivable: [],
    medicareCoverage: [],
  } as unknown as ClientData;
}

describe("buildCashFlowYearDetail", () => {
  it("reconciles inflow / outflow / net totals to the canonical year totals", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    const inflowSum = d.inflows.reduce((s, c) => s + c.total, 0);
    const outflowSum = d.outflows.reduce((s, c) => s + c.total, 0);
    expect(Math.round(inflowSum)).toBe(120_000);
    expect(Math.round(outflowSum)).toBe(103_000);
    expect(d.totals.inflows).toBe(120_000);
    expect(d.totals.outflows).toBe(103_000);
    expect(d.totals.net).toBe(17_000);
  });

  it("resolves income source names and drops $0 sources", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    const income = d.inflows.find((c) => c.key === "income")!;
    expect(income.items.map((i) => i.label)).toEqual(["Social Security", "Pension"]);
    expect(income.items.every((i) => i.amount > 0)).toBe(true);
  });

  it("lists RMDs by source account name, omitting zero-RMD accounts", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    const rmds = d.inflows.find((c) => c.key === "rmds")!;
    expect(rmds.total).toBe(15_000);
    expect(rmds.items).toEqual([
      { id: "acc-ira", label: "Traditional IRA", amount: 15_000 },
    ]);
  });

  it("lists liabilities and savings by name", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    const liabilities = d.outflows.find((c) => c.key === "liabilities")!;
    expect(liabilities.items).toEqual([
      { id: "liab-mortgage", label: "Home Mortgage", amount: 12_000 },
    ]);
    const savings = d.outflows.find((c) => c.key === "savings")!;
    expect(savings.items).toEqual([
      { id: "acc-401k", label: "401(k)", amount: 10_000 },
    ]);
  });

  it("surfaces an Other-inflows residual when totalIncome exceeds enumerated inflows", () => {
    // income(70k via bySource) + rmds(15k) + withdrawals(20k) = 105k; totalIncome 120k ⇒ 15k residual
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    const residual = d.inflows.find((c) => c.key === "residual");
    expect(residual?.total).toBe(15_000);
  });

  it("builds an age label with the spouse age only when married", () => {
    const married = buildCashFlowYearDetail(makeYear(), makeClientData());
    expect(married.ageLabel).toBe("Age 67 / 65");
    const single = buildCashFlowYearDetail(
      makeYear({ ages: { client: 67 } }),
      makeClientData(),
    );
    expect(single.ageLabel).toBe("Age 67");
  });

  it("uses liquidPortfolioTotal-style liquid total for ending portfolio", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    expect(d.totals.endingPortfolio).toBe(800_000); // liquidTotal
  });

  it("produces a negative residual 'Other' outflow when enumerated categories exceed totalExpenses", () => {
    // Enumerated outflow categories in the default makeYear fixture sum to 103k:
    //   living(60k) + liabilities(byLiability=12k) + other(5k) + insurance(3k)
    //   + realEstate(4k) + taxes(9k) + savings(byAccount=10k) = 103k
    // Setting totalExpenses to 90k forces outflowResidual = 90k - 103k = -13k (negative branch).
    const d = buildCashFlowYearDetail(makeYear({ totalExpenses: 90_000 }), makeClientData());

    const outflowSum = d.outflows.reduce((s, c) => s + c.total, 0);
    // Column must still tie out exactly to the canonical totalExpenses.
    expect(Math.round(outflowSum)).toBe(d.totals.outflows);
    expect(d.totals.outflows).toBe(90_000);

    // A "residual" (Other) outflow category must exist and be negative.
    const residual = d.outflows.find((c) => c.key === "residual");
    expect(residual).toBeDefined();
    expect(residual!.total).toBeLessThan(0);
    expect(residual!.total).toBe(-13_000);
  });

  it("does not throw on an empty year", () => {
    const empty = makeYear({
      income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
      withdrawals: { byAccount: {}, total: 0 },
      accountLedgers: {},
      expenses: { living: 0, liabilities: 0, other: 0, insurance: 0, realEstate: 0, taxes: 0, cashGifts: 0, discretionary: 0, total: 0, bySource: {}, byLiability: {}, interestByLiability: {} },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalIncome: 0, totalExpenses: 0, netCashFlow: 0,
    });
    expect(() => buildCashFlowYearDetail(empty, makeClientData())).not.toThrow();
  });
});
