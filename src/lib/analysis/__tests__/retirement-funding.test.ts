import { describe, it, expect } from "vitest";
import type { Account, ProjectionYear } from "@/engine/types";
import { accountTaxBucket, lifetimeFunding } from "../retirement-funding";

function acct(id: string, category: Account["category"], subType: string): Account {
  return { id, category, subType } as Account;
}

// Minimal ProjectionYear factory — only fields the funding math reads.
function yr(year: number, over: Partial<ProjectionYear>): ProjectionYear {
  return {
    year,
    income: { socialSecurity: 0, salaries: 0, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0 },
    withdrawals: { byAccount: {}, total: 0 },
    accountLedgers: {},
    totalExpenses: 0,
    ...over,
  } as unknown as ProjectionYear;
}

describe("accountTaxBucket", () => {
  it("maps categories/subtypes to tax buckets", () => {
    expect(accountTaxBucket(acct("a", "cash", "savings"))).toBe("cash");
    expect(accountTaxBucket(acct("b", "taxable", "brokerage"))).toBe("taxable");
    expect(accountTaxBucket(acct("c", "retirement", "roth_ira"))).toBe("roth");
    expect(accountTaxBucket(acct("d", "retirement", "traditional_ira"))).toBe("preTax");
    expect(accountTaxBucket(acct("e", "retirement", "401k"))).toBe("preTax");
    expect(accountTaxBucket(acct("f", "real_estate", "primary_residence"))).toBe("taxable");
  });
});

describe("lifetimeFunding", () => {
  const accounts = [
    acct("cash1", "cash", "savings"),
    acct("tax1", "taxable", "brokerage"),
    acct("ira1", "retirement", "traditional_ira"),
    acct("roth1", "retirement", "roth_ira"),
  ];

  it("sums sources across retirement years only (year >= retirementYear)", () => {
    const years = [
      yr(2030, { totalExpenses: 999 }), // pre-retirement — excluded
      yr(2031, {
        income: { socialSecurity: 30_000, salaries: 10_000, business: 5_000, deferred: 0, capitalGains: 0, trust: 0, other: 0 },
        withdrawals: { byAccount: { cash1: 4_000, tax1: 6_000, ira1: 8_000, roth1: 2_000 }, total: 20_000 },
        accountLedgers: { ira1: { rmdAmount: 7_000 }, roth1: { rmdAmount: 0 } },
        totalExpenses: 82_000,
      }),
    ];
    const f = lifetimeFunding(years as ProjectionYear[], accounts, 2031);
    expect(f.socialSecurity).toBe(30_000);
    expect(f.otherIncome).toBe(15_000); // salaries 10k + business 5k
    expect(f.rmds).toBe(7_000);
    expect(f.withdrawalsCash).toBe(4_000);
    expect(f.withdrawalsTaxable).toBe(6_000);
    expect(f.withdrawalsPreTax).toBe(8_000);
    expect(f.withdrawalsRoth).toBe(2_000);
    expect(f.totalSpending).toBe(82_000);
    // funded = 30k+15k+7k+20k = 72k; shortfall = 82k-72k = 10k
    expect(f.totalFunded).toBe(72_000);
    expect(f.shortfall).toBe(10_000);
  });

  it("clamps shortfall at zero when fully funded", () => {
    const years = [
      yr(2031, {
        income: { socialSecurity: 90_000, salaries: 0, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0 },
        withdrawals: { byAccount: {}, total: 0 },
        accountLedgers: {},
        totalExpenses: 50_000,
      }),
    ];
    const f = lifetimeFunding(years as ProjectionYear[], accounts, 2031);
    expect(f.shortfall).toBe(0);
  });
});
