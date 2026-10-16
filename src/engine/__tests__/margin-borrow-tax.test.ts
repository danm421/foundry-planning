// src/engine/__tests__/margin-borrow-tax.test.ts
import { describe, it, expect } from "vitest";
import { BORROWER, runBorrow } from "./_fixtures/margin";
import { FIXTURE_TAX_PARAMS } from "./fixtures";

// Example B in bracket mode: a $200K investment loan, then borrowing for
// spending in 2026. Growth is 10%, all ordinary income, so net investment
// income (~$100K/yr) never caps the deduction and nothing carries forward.
const years = runBorrow(
  [{ ...BORROWER, marginBalance: 200_000, growthRate: 0.1,
     realization: { pctOrdinaryIncome: 1, pctQualifiedDividends: 0, pctLtCapitalGains: 0, pctTaxExempt: 0, turnoverPct: 0 } }],
  { planSettings: { taxEngineMode: "bracket" }, data: { taxYearRows: FIXTURE_TAX_PARAMS } },
);
const [y1, y2] = years;

describe("Form 4952 sees only investment-use interest (spec 2026-10-14)", () => {
  it("year 1: the plan-start loan is investment debt — all $16,000 is investment interest", () => {
    expect(y1.accountLedgers["acct-borrow"].marginInterest).toBeCloseTo(16_000, 2);
    expect(y1.accountLedgers["acct-borrow"].marginInterestPersonal).toBeUndefined();
    expect(y1.deductionBreakdown!.belowLine.investmentInterest).toBeCloseTo(16_000, 2);
  });
  it("year 2: only the investment-use part reaches the deduction; the rest is listed as personal", () => {
    const borrowed = y1.withdrawals.borrowedByAccount!["acct-borrow"];
    expect(borrowed).toBeGreaterThan(0);
    const l2 = y2.accountLedgers["acct-borrow"];
    expect(l2.marginInterestPersonal).toBeCloseTo(borrowed * 0.08, 2);
    expect(y2.deductionBreakdown!.belowLine.investmentInterest).toBeCloseTo(216_000 * 0.08, 2);
    expect(y2.deductionBreakdown!.belowLine.personalMarginInterest).toEqual({
      "acct-borrow": { label: "Schwab Brokerage", amount: expect.closeTo(borrowed * 0.08, 2) },
    });
  });
});
