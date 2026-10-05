import { describe, it, expect } from "vitest";
import { yearCashFlow } from "../year-table-cash-flow";
import type { ClientData, ProjectionYear } from "@/engine";

// Engine totals, as projection.ts derives them:
//   totalIncome   = income.total 120k + household RMD 15k + note cash 6k = 141k
//   totalExpenses = expenses.total 93k + savings 10k                      = 103k
// The trust IRA's 8k RMD lands in the trust's checking, so it is NOT in
// totalIncome and must not reach the household's Cash In.
function makeYear(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  return {
    year: 2034,
    ages: { client: 67, spouse: 65 },
    income: {
      salaries: 50_000, socialSecurity: 40_000, business: 0, trust: 0,
      deferred: 30_000, capitalGains: 0, other: 0, total: 120_000,
      bySource: {},
    },
    withdrawals: { byAccount: { "acc-brokerage": 20_000 }, total: 20_000 },
    accountLedgers: {
      "acc-ira": { rmdAmount: 15_000 } as never,
      "acc-trust-ira": { rmdAmount: 8_000 } as never,
    },
    expenses: {
      living: 60_000, liabilities: 12_000, other: 5_000, insurance: 3_000,
      realEstate: 4_000, taxes: 9_000, cashGifts: 0, discretionary: 0,
      total: 93_000, bySource: {}, byLiability: {}, interestByLiability: {},
    },
    savings: { byAccount: { "acc-401k": 10_000 }, total: 10_000, employerTotal: 0 },
    totalIncome: 141_000,
    totalExpenses: 103_000,
    netCashFlow: 38_000,
    ...overrides,
  } as ProjectionYear;
}

const clientData = {
  accounts: [
    { id: "acc-ira", owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }] },
    { id: "acc-trust-ira", owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }] },
  ],
} as unknown as ClientData;

describe("yearCashFlow", () => {
  it("ties out: the in columns sum to Total In, the out columns to Total Out, and In − Out = Net", () => {
    const cf = yearCashFlow(makeYear(), clientData);
    expect(cf.socialSecurity + cf.salaries + cf.otherIncome + cf.rmds + cf.withdrawals).toBe(cf.totalIn);
    expect(cf.living + cf.taxes + cf.otherExpenses + cf.savings).toBe(cf.totalOut);
    expect(cf.totalIn - cf.totalOut).toBe(cf.net);
  });

  it("anchors the totals to the engine: Total In = totalIncome + withdrawals, Total Out = totalExpenses", () => {
    const cf = yearCashFlow(makeYear(), clientData);
    expect(cf.totalIn).toBe(161_000);
    expect(cf.totalOut).toBe(103_000);
    expect(cf.net).toBe(58_000);
  });

  it("counts only household-owned RMDs (a trust's RMD never reaches household cash)", () => {
    expect(yearCashFlow(makeYear(), clientData).rmds).toBe(15_000);
  });

  it("gives Other Income whatever totalIncome holds beyond SS, salaries and RMDs", () => {
    // pension 30k + note cash 6k; an equity sale's cash (in totalIncome, never
    // in income.other) lands here too rather than vanishing from the row.
    expect(yearCashFlow(makeYear(), clientData).otherIncome).toBe(36_000);
    const withEquity = makeYear({ totalIncome: 151_000 });
    expect(yearCashFlow(withEquity, clientData).otherIncome).toBe(46_000);
  });

  it("splits Cash Out into living, taxes, every other expense, and savings", () => {
    const cf = yearCashFlow(makeYear(), clientData);
    expect(cf.living).toBe(60_000);
    expect(cf.taxes).toBe(9_000);
    expect(cf.otherExpenses).toBe(24_000); // debt 12k + other 5k + insurance 3k + real estate 4k
    expect(cf.savings).toBe(10_000);
  });

  it("counts a solver hypothetical contribution as savings", () => {
    const y = makeYear({
      hypotheticalSavings: { contribution: 4_000, fromCashFlow: 4_000, fromExpenseReduction: 0 },
      totalExpenses: 107_000,
    });
    expect(yearCashFlow(y, clientData).savings).toBe(14_000);
  });

  it("goes negative when spending outruns everything that came in", () => {
    const y = makeYear({ totalIncome: 60_000, withdrawals: { byAccount: {}, total: 0 } });
    expect(yearCashFlow(y, clientData).net).toBe(-43_000);
  });
});
