import { describe, it, expect } from "vitest";
import { buildYearCellDrill } from "../year-cell-drill";
import type { ClientData, ProjectionYear } from "@/engine";

// Minimal ProjectionYear factory — only the fields the builder reads.
// Cash In: SS 40k + salaries 50k + other (pension 30k + note 6k) 36k
// + household RMD 15k + withdrawals 20k = 161k. The trust IRA's 8k RMD goes to
// the trust's checking, so it is in neither totalIncome (141k) nor Cash In.
// Cash Out: totalExpenses 103k → Surplus 58k.
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
      "acc-trust-ira": { rmdAmount: 8_000 } as never, // entity-owned — not household cash
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
    totalIncome: 141_000,
    totalExpenses: 103_000,
    netCashFlow: 38_000,
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
      { id: "acc-trust-ira", name: "Trust IRA", category: "retirement", owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }] },
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

  it("otherIncome: names an equity sale's cash, which totalIncome counts outside income.other", () => {
    const y = makeYear({ totalIncome: 151_000 });
    y.income.bySource = { ...y.income.bySource, "equity-proceeds:plan-1": 10_000 };
    const d = buildYearCellDrill("otherIncome", y, makeClientData())!;
    expect(d.total).toBe(46_000); // pension 30k + note cash 6k + equity cash 10k
    const rows = rowsOf(d);
    expect(rows.map((r) => r.id)).toContain("equity-proceeds:plan-1");
    expect(rows.map((r) => r.label)).not.toContain("Other");
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(46_000);
  });

  it("rmds: household-owned accounts only — a trust's RMD never reaches household cash", () => {
    const d = buildYearCellDrill("rmds", makeYear(), makeClientData())!;
    expect(d.total).toBe(15_000);
    expect(rowsOf(d).map((r) => r.label)).toEqual(["Traditional IRA"]);
  });

  it("withdrawals: one row per account", () => {
    const d = buildYearCellDrill("withdrawals", makeYear(), makeClientData())!;
    expect(d.total).toBe(20_000);
    expect(rowsOf(d)).toEqual([{ id: "acc-brokerage", label: "Joint Brokerage", amount: 20_000 }]);
  });

  it("totalIn: the five Cash In columns, tying exactly to Total In", () => {
    const d = buildYearCellDrill("totalIn", makeYear(), makeClientData())!;
    expect(d.title).toBe("Total In — 2034");
    expect(d.total).toBe(161_000);
    expect(rowsOf(d).map((r) => r.label)).toEqual([
      "Social Security", "Salaries", "Other Income", "RMDs", "Withdrawals",
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

  it("taxes: names the withholding netting as 'Already withheld' instead of an anonymous negative Other", () => {
    // A tax_adjustment's withholding pays Federal + State (9k gross) down to a
    // 5k net cash-flow liability. Without a named item, balanced()'s balancing
    // row absorbs the -4k gap into an unlabelled "Other".
    const d = buildYearCellDrill(
      "taxes",
      makeYear({
        expenses: { ...makeYear().expenses, taxes: 5_000 },
        taxResult: {
          flow: { totalFederalTax: 7_000, stateTax: 2_000, taxAlreadyPaid: 4_000 },
        } as never,
      }),
      makeClientData(),
    )!;
    expect(d.total).toBe(5_000);
    expect(rowsOf(d)).toEqual([
      { id: "tax-federal", label: "Federal", amount: 7_000 },
      { id: "tax-state", label: "State", amount: 2_000 },
      { id: "tax-already-paid", label: "Already withheld", amount: -4_000 },
    ]);
    expect(rowsOf(d).some((r) => r.label === "Other")).toBe(false);
  });

  it("taxes: degrades to a balancing Other row when taxResult is absent", () => {
    const d = buildYearCellDrill("taxes", makeYear({ taxResult: undefined }), makeClientData())!;
    expect(rowsOf(d)).toEqual([{ id: "taxes-other", label: "Other", amount: 9_000 }]);
  });

  it("otherExpenses: one group per category, item rows naming what was paid", () => {
    const d = buildYearCellDrill("otherExpenses", makeYear(), makeClientData())!;
    expect(d.total).toBe(24_000); // debt 12k + insurance 3k + real estate 4k + other 5k
    expect(d.groups.map((g) => g.label)).toEqual([
      "Debt Payments", "Insurance Premiums", "Real Estate", "Other",
    ]);
    expect(d.groups[0].rows).toEqual([{ id: "liab-mortgage", label: "Home Mortgage", amount: 12_000 }]);
    expect(d.groups[3].rows).toEqual([{ id: "exp-misc", label: "Misc", amount: 5_000 }]);
    expect(rowsOf(d).reduce((s, r) => s + r.amount, 0)).toBe(24_000);
  });

  it("otherExpenses: surplus spent gets its own group", () => {
    const y = makeYear();
    y.expenses = { ...y.expenses, discretionary: 2_000, total: 95_000 };
    const d = buildYearCellDrill("otherExpenses", { ...y, totalExpenses: 105_000 }, makeClientData())!;
    expect(d.total).toBe(26_000);
    expect(d.groups.at(-1)).toEqual({
      label: "Surplus Spent",
      rows: [{ id: "discretionary", label: "Surplus Spent", amount: 2_000 }],
    });
  });

  it("savings: one row per account, plus the Solver's hypothetical contribution", () => {
    const y = makeYear({
      hypotheticalSavings: { contribution: 4_000, fromCashFlow: 4_000, fromExpenseReduction: 0 },
      totalExpenses: 107_000,
    });
    const d = buildYearCellDrill("savings", y, makeClientData())!;
    expect(d.total).toBe(14_000);
    expect(rowsOf(d)).toEqual([
      { id: "acc-401k", label: "401(k)", amount: 10_000 },
      { id: "hypoContribution", label: "Hypothetical Savings", amount: 4_000 },
    ]);
  });

  it("totalOut: the four Cash Out columns, tying exactly to Total Out", () => {
    const d = buildYearCellDrill("totalOut", makeYear(), makeClientData())!;
    expect(d.total).toBe(103_000);
    expect(rowsOf(d).map((r) => r.label)).toEqual([
      "Living Expenses", "Taxes", "Other Expenses", "Savings",
    ]);
    expect(rowsOf(d).reduce((s, r) => s + r.amount, 0)).toBe(103_000);
  });

  it("net: a surplus year shows Total In less Total Out", () => {
    const d = buildYearCellDrill("net", makeYear(), makeClientData())!;
    expect(d.title).toBe("Surplus — 2034");
    expect(d.total).toBe(58_000);
    expect(d.totalLabel).toBe("Surplus");
    expect(rowsOf(d)).toEqual([
      { id: "in", label: "Total In", amount: 161_000 },
      { id: "out", label: "Less: Total Out", amount: -103_000 },
    ]);
  });

  it("net: a shortfall year shows Total Out less Total In, as a positive shortfall", () => {
    const d = buildYearCellDrill("net", makeYear({ totalExpenses: 200_000 }), makeClientData())!;
    expect(d.title).toBe("Shortfall — 2034");
    expect(d.total).toBe(39_000); // 200k − 161k
    expect(d.totalLabel).toBe("Shortfall");
    expect(rowsOf(d)).toEqual([
      { id: "out", label: "Total Out", amount: 200_000 },
      { id: "in", label: "Less: Total In", amount: -161_000 },
    ]);
  });

  it("net: no drill when the year breaks even", () => {
    expect(buildYearCellDrill("net", makeYear({ totalExpenses: 161_000 }), makeClientData())).toBeNull();
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
