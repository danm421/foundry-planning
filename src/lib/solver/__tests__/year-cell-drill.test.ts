import { describe, it, expect } from "vitest";
import { buildYearCellDrill } from "../year-cell-drill";
import type { ClientData, ProjectionYear } from "@/engine";

// Minimal ProjectionYear factory — only the fields the builder reads.
// Inflow math: SS 40k + salaries 50k + other (pension 30k + note 6k) 36k
// + RMDs (15k + 8k entity) 23k + withdrawals 20k = 169k total inflows.
function makeYear(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  return {
    year: 2034,
    ages: { client: 67, spouse: 65 },
    income: {
      salaries: 50_000, socialSecurity: 40_000, business: 0, trust: 0,
      deferred: 30_000, capitalGains: 0, other: 0, total: 120_000,
      bySource: { "inc-ss": 40_000, "inc-pen": 30_000, "inc-salary": 50_000 },
    },
    socialSecurityDetail: {
      client: { retirement: 28_000, spousal: 0, survivor: 0 },
      spouse: { retirement: 0, spousal: 12_000, survivor: 0 },
    },
    withdrawals: { byAccount: { "acc-brokerage": 20_000 }, total: 20_000 },
    accountLedgers: {
      "acc-ira": { rmdAmount: 15_000 } as never,
      "acc-trust-ira": { rmdAmount: 8_000 } as never, // entity-owned — still counted here
      "acc-brokerage": { rmdAmount: 0 } as never,
    },
    notesReceivableByNote: {
      "note-1": { interest: 1_000, principalLTCG: 2_000, principalBasis: 3_000, totalCashIn: 6_000, endingBalance: 50_000 },
    },
    // householdCashIn feeds otherInflows() — without it the Other Income total
    // would be 30k and the note row would spawn a −6k balancing entry.
    notesReceivableTotals: {
      interest: 1_000, principalLTCG: 2_000, principalBasis: 3_000,
      totalCashIn: 6_000, householdCashIn: 6_000,
    } as never,
    expenses: {
      living: 60_000, liabilities: 12_000, other: 5_000, insurance: 3_000,
      realEstate: 4_000, taxes: 9_000, cashGifts: 0, discretionary: 0,
      total: 93_000,
      bySource: { "exp-groceries": 35_000, "exp-travel": 25_000, "exp-misc": 5_000, "exp-mortgage-ins": 3_000 },
      byLiability: { "liab-mortgage": 12_000 },
      interestByLiability: { "liab-mortgage": 7_000 },
    },
    savings: { byAccount: { "acc-401k": 10_000 }, total: 10_000, employerTotal: 0 },
    taxResult: { flow: { totalFederalTax: 7_000, stateTax: 2_000 } } as never,
    totalIncome: 149_000,
    totalExpenses: 103_000,
    netCashFlow: -18_000,
    portfolioAssets: {
      taxable: { "acc-brokerage": 400_000 }, cash: { "acc-check": 50_000 },
      retirement: { "acc-ira": 300_000, "acc-401k": 250_000 },
      realEstate: {}, business: {}, lifeInsurance: {}, stockOptions: {},
      taxableTotal: 400_000, cashTotal: 50_000, retirementTotal: 550_000,
      realEstateTotal: 0, businessTotal: 0, lifeInsuranceTotal: 0,
      stockOptionsTotal: 0, trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
      total: 1_000_000, liquidTotal: 1_000_000,
    },
    ...overrides,
  } as ProjectionYear;
}

const fmOwner = [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }];

function makeClientData(): ClientData {
  return {
    client: { firstName: "Alice", lastName: "B", spouseName: "Bob" },
    incomes: [
      { id: "inc-ss", name: "Social Security", type: "social_security" },
      { id: "inc-pen", name: "Pension", type: "deferred" },
      { id: "inc-salary", name: "Alice Salary", type: "salary" },
    ],
    entities: [],
    accounts: [
      { id: "acc-ira", name: "Traditional IRA", category: "retirement", owners: fmOwner },
      { id: "acc-trust-ira", name: "Trust IRA", category: "retirement", owners: fmOwner },
      { id: "acc-brokerage", name: "Joint Brokerage", category: "taxable", owners: fmOwner },
      { id: "acc-401k", name: "401(k)", category: "retirement", owners: fmOwner },
      { id: "acc-check", name: "Checking", category: "cash", owners: fmOwner },
    ],
    liabilities: [{ id: "liab-mortgage", name: "Home Mortgage" }],
    expenses: [
      { id: "exp-groceries", name: "Groceries", type: "living" },
      { id: "exp-travel", name: "Travel", type: "living" },
      { id: "exp-misc", name: "Misc", type: "other" },
      { id: "exp-mortgage-ins", name: "Life Policy Premium", type: "insurance" },
    ],
    assetTransactions: [],
    stockOptionPlans: [],
    notesReceivable: [{ id: "note-1", name: "Practice Sale" }],
    medicareCoverage: [],
  } as unknown as ClientData;
}

function rowsOf(d: NonNullable<ReturnType<typeof buildYearCellDrill>>) {
  return d.groups.flatMap((g) => g.rows);
}

describe("buildYearCellDrill — income side", () => {
  it("socialSecurity: per-person parts from socialSecurityDetail, tying to the column total", () => {
    const d = buildYearCellDrill("socialSecurity", makeYear(), makeClientData())!;
    expect(d.title).toBe("Social Security — 2034");
    expect(d.subtitle).toBe("Age 67 / 65");
    expect(d.total).toBe(40_000);
    const rows = rowsOf(d);
    expect(rows.map((r) => r.label)).toEqual(["Alice — Retirement", "Bob — Spousal"]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(40_000);
  });

  it("socialSecurity: falls back to SS income sources when socialSecurityDetail is absent", () => {
    const d = buildYearCellDrill(
      "socialSecurity",
      makeYear({ socialSecurityDetail: undefined }),
      makeClientData(),
    )!;
    expect(rowsOf(d).map((r) => r.label)).toEqual(["Social Security"]);
    expect(d.total).toBe(40_000);
  });

  it("salaries: one row per salary-typed income source", () => {
    const d = buildYearCellDrill("salaries", makeYear(), makeClientData())!;
    expect(d.total).toBe(50_000);
    expect(rowsOf(d)).toEqual([{ id: "inc-salary", label: "Alice Salary", amount: 50_000 }]);
  });

  it("otherIncome: non-salary/SS sources plus notes-receivable cash", () => {
    const d = buildYearCellDrill("otherIncome", makeYear(), makeClientData())!;
    expect(d.total).toBe(36_000); // pension 30k + note cash 6k
    const labels = rowsOf(d).map((r) => r.label);
    expect(labels).toContain("Pension");
    expect(labels).toContain("Note: Practice Sale");
    expect(rowsOf(d).reduce((s, r) => s + r.amount, 0)).toBe(36_000);
  });

  it("rmds: one row per account with an RMD, counting ALL ledgers (matches rmdTotal)", () => {
    const d = buildYearCellDrill("rmds", makeYear(), makeClientData())!;
    expect(d.total).toBe(23_000); // 15k + 8k — entity ledger included, unlike the cash-flow panel
    expect(rowsOf(d).map((r) => r.label).sort()).toEqual(["Traditional IRA", "Trust IRA"]);
  });

  it("withdrawals: one row per account", () => {
    const d = buildYearCellDrill("withdrawals", makeYear(), makeClientData())!;
    expect(d.total).toBe(20_000);
    expect(rowsOf(d)).toEqual([{ id: "acc-brokerage", label: "Joint Brokerage", amount: 20_000 }]);
  });

  it("totalIncomeWithdrawals: the five band subtotals, no balancing row", () => {
    const d = buildYearCellDrill("totalIncomeWithdrawals", makeYear(), makeClientData())!;
    expect(d.total).toBe(169_000);
    expect(rowsOf(d).map((r) => r.label)).toEqual([
      "Social Security", "Salaries", "Other Income", "RMDs", "Portfolio Withdrawals",
    ]);
    expect(rowsOf(d).reduce((s, r) => s + r.amount, 0)).toBe(d.total);
  });

  it("appends a balancing Other row when items do not sum to the column total", () => {
    // Drop the salary source from bySource but keep income.salaries at 50k.
    const y = makeYear();
    y.income.bySource = { "inc-ss": 40_000, "inc-pen": 30_000 };
    const d = buildYearCellDrill("salaries", y, makeClientData())!;
    expect(rowsOf(d)).toEqual([{ id: "salaries-other", label: "Other", amount: 50_000 }]);
    expect(d.total).toBe(50_000);
  });

  it("returns null for an all-zero cell", () => {
    const y = makeYear();
    y.withdrawals = { byAccount: {}, total: 0 };
    expect(buildYearCellDrill("withdrawals", y, makeClientData())).toBeNull();
  });
});

describe("buildYearCellDrill — expenses & portfolio", () => {
  it("livingExpenses: one row per living-typed expense", () => {
    const d = buildYearCellDrill("livingExpenses", makeYear(), makeClientData())!;
    expect(d.total).toBe(60_000);
    expect(rowsOf(d).map((r) => r.label)).toEqual(["Groceries", "Travel"]);
  });

  it("taxes: Federal / State from taxResult.flow", () => {
    const d = buildYearCellDrill("taxes", makeYear(), makeClientData())!;
    expect(d.total).toBe(9_000);
    expect(rowsOf(d)).toEqual([
      { id: "tax-federal", label: "Federal", amount: 7_000 },
      { id: "tax-state", label: "State", amount: 2_000 },
    ]);
  });

  it("taxes: degrades to a balancing Other row when taxResult is absent", () => {
    const d = buildYearCellDrill("taxes", makeYear({ taxResult: undefined }), makeClientData())!;
    expect(rowsOf(d)).toEqual([{ id: "taxes-other", label: "Other", amount: 9_000 }]);
  });

  it("totalExpenses: category subtotals tying to totalExpenses (savings included, cashGifts not double-counted)", () => {
    const d = buildYearCellDrill("totalExpenses", makeYear(), makeClientData())!;
    expect(d.total).toBe(103_000);
    const rows = rowsOf(d);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(103_000);
    expect(rows.map((r) => r.label)).toContain("Savings");
    expect(rows.map((r) => r.label)).not.toContain("Cash Gifts"); // inside Other Expenses already
  });

  it("shortfall: shows the expenses-minus-inflows math when positive", () => {
    // totalExpenses 103k − inflows 169k → no shortfall in the base fixture.
    expect(buildYearCellDrill("shortfall", makeYear(), makeClientData())).toBeNull();
    const y = makeYear({ totalExpenses: 200_000 });
    const d = buildYearCellDrill("shortfall", y, makeClientData())!;
    expect(d.total).toBe(31_000); // 200k − 169k
    expect(d.totalLabel).toBe("Shortfall");
    expect(rowsOf(d)).toEqual([
      { id: "expenses", label: "Total Expenses", amount: 200_000 },
      { id: "inflows", label: "Less: Total Income & Withdrawals", amount: -169_000 },
    ]);
  });

  it("portfolioAssets: per-account EoY balances grouped Taxable/Cash/Retirement, tying to liquidPortfolioTotal", () => {
    const d = buildYearCellDrill("portfolioAssets", makeYear(), makeClientData())!;
    expect(d.total).toBe(1_000_000);
    expect(d.groups.map((g) => g.label)).toEqual(["Taxable", "Cash", "Retirement"]);
    const retirement = d.groups[2].rows;
    expect(retirement.map((r) => r.label)).toEqual(["Traditional IRA", "401(k)"]); // desc by amount
    expect(d.groups.flatMap((g) => g.rows).reduce((s, r) => s + r.amount, 0)).toBe(1_000_000);
  });
});
