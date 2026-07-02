import { describe, it, expect } from "vitest";
import { categorizeDraw } from "../withdrawal";
import type { Account } from "../types";

function acct(over: Partial<Account>): Account {
  return {
    id: "a", name: "529", category: "retirement", subType: "529", value: 0,
    basis: 0, growthRate: 0.05, rmdEnabled: false, titlingType: "jtwros",
    owners: [], ...over,
  } as Account;
}

describe("categorizeDraw 529", () => {
  it("529 qualified draw is fully tax-free (no OI, no CG, no penalty)", () => {
    const d = categorizeDraw({
      account: acct({}), amount: 10000, balance: 30000,
      basisMap: { a: 5000 }, rothValueMap: {}, ownerAge: 45,
    });
    expect(d.ordinaryIncome).toBe(0);
    expect(d.capitalGains).toBe(0);
    expect(d.earlyWithdrawalPenalty).toBe(0);
    expect(d.basisReturn).toBe(10000);
  });

  // Regression: real 529 accounts are imported with category "taxable"
  // (Plaid/Orion/portal all classify 529 that way). The tax-free guard must
  // fire regardless of category — otherwise a real 529 is taxed as cap gains.
  it("529 with production category 'taxable' is still fully tax-free", () => {
    const d = categorizeDraw({
      account: acct({ category: "taxable" }), amount: 10000, balance: 30000,
      basisMap: { a: 5000 }, rothValueMap: {}, ownerAge: 45,
    });
    expect(d.ordinaryIncome).toBe(0);
    expect(d.capitalGains).toBe(0);
    expect(d.earlyWithdrawalPenalty).toBe(0);
    expect(d.basisReturn).toBe(10000);
  });
});
