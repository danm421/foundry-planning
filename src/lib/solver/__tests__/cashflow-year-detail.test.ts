import { describe, it, expect } from "vitest";
import { buildCashFlowYearDetail } from "../cashflow-year-detail";
import type { ClientData, ProjectionYear } from "@/engine";

// Minimal ProjectionYear factory — only the fields the helper reads. Engine-
// consistent: totalIncome = displayIncome.total (70k) + household RMD (15k) = 85k
// and EXCLUDES the 20k portfolio withdrawal and the 8k entity-owned RMD.
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
      "acc-ira": { rmdAmount: 15_000 } as never,       // household-owned
      "acc-trust-ira": { rmdAmount: 8_000 } as never,  // entity-owned → excluded
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
    totalIncome: 85_000,
    totalExpenses: 103_000,
    netCashFlow: -18_000,
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

const fmOwner = [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }];
const entityOwner = [{ kind: "entity", entityId: "ent-trust", percent: 1 }];

function makeClientData(): ClientData {
  return {
    client: { firstName: "A", lastName: "B" },
    incomes: [
      { id: "inc-ss", name: "Social Security", type: "social_security" },
      { id: "inc-pen", name: "Pension", type: "deferred" },
    ],
    entities: [],
    accounts: [
      { id: "acc-ira", name: "Traditional IRA", category: "retirement", owners: fmOwner },
      { id: "acc-trust-ira", name: "Trust IRA", category: "retirement", owners: entityOwner },
      { id: "acc-brokerage", name: "Joint Brokerage", category: "taxable", owners: fmOwner },
      { id: "acc-401k", name: "401(k)", category: "retirement", owners: fmOwner },
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
    // Inflow categories (income 70k + household RMD 15k) tie to totalIncome (85k);
    // withdrawals are NOT part of the reconciled inflows.
    expect(Math.round(inflowSum)).toBe(85_000);
    expect(Math.round(outflowSum)).toBe(103_000);
    expect(d.totals.inflows).toBe(85_000);
    expect(d.totals.outflows).toBe(103_000);
    expect(d.totals.net).toBe(-18_000);
  });

  it("resolves income source names and drops $0 sources", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    const income = d.inflows.find((c) => c.key === "income")!;
    expect(income.items.map((i) => i.label)).toEqual(["Social Security", "Pension"]);
    expect(income.items.every((i) => i.amount > 0)).toBe(true);
  });

  it("lists RMDs only for household-owned accounts, excluding entity-owned RMDs", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    const rmds = d.inflows.find((c) => c.key === "rmds")!;
    expect(rmds.total).toBe(15_000); // entity-owned acc-trust-ira (8k) excluded
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

  it("surfaces portfolio withdrawals as a separate line, not a negative Other inflow", () => {
    const d = buildCashFlowYearDetail(makeYear(), makeClientData());
    // Withdrawals are their own field...
    expect(d.withdrawals?.total).toBe(20_000);
    expect(d.withdrawals?.items).toEqual([
      { id: "acc-brokerage", label: "Joint Brokerage", amount: 20_000 },
    ]);
    // ...not a category in the reconciled inflow list...
    expect(d.inflows.find((c) => c.key === "withdrawals")).toBeUndefined();
    // ...and no spurious balancing residual (the old −withdrawals "Other" bug).
    expect(d.inflows.find((c) => c.key === "residual")).toBeUndefined();
  });

  it("still surfaces a genuine positive Other-inflow residual when totalIncome exceeds enumerated inflows", () => {
    // totalIncome 92k vs enumerated income(70k)+householdRmd(15k)=85k ⇒ 7k residual
    // (e.g. a household note/equity cash-in folded into totalIncome but not itemized).
    const d = buildCashFlowYearDetail(makeYear({ totalIncome: 92_000 }), makeClientData());
    const residual = d.inflows.find((c) => c.key === "residual");
    expect(residual?.total).toBe(7_000);
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
    const d = buildCashFlowYearDetail(empty, makeClientData());
    expect(d.withdrawals).toBeNull();
  });
});
