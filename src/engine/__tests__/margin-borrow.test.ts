// src/engine/__tests__/margin-borrow.test.ts
import { describe, it, expect } from "vitest";
import { BORROWER, CHECKING, runBorrow, runMargin, spending } from "./_fixtures/margin";
import type { Account } from "../types";

const at = (years: ReturnType<typeof runBorrow>, year: number) => years.find((y) => y.year === year)!;

describe("borrowing on margin — the projection (spec 2026-10-14)", () => {
  it("example A: borrows the shortfall instead of selling — no gain, basis untouched", () => {
    const y1 = at(runBorrow([BORROWER]), 2026);
    const l = y1.accountLedgers["acct-borrow"];
    expect(y1.withdrawals.borrowedByAccount).toEqual({ "acct-borrow": expect.closeTo(100_000, 2) });
    expect(y1.withdrawals.byAccount["acct-borrow"]).toBeCloseTo(100_000, 2);
    expect(l.endingValue).toBeCloseTo(900_000, 2);
    expect(l.basisEoY).toBeCloseTo(400_000, 2);
    expect(y1.taxDetail!.capitalGains).toBeCloseTo(0, 6);
    expect(l.entries.find((e) => e.category === "margin_borrow")?.amount).toBeCloseTo(-100_000, 2);
  });

  it("borrowing from no loan stamps the year-end loan (Review Focus 5)", () => {
    const l = at(runBorrow([BORROWER]), 2026).accountLedgers["acct-borrow"];
    expect(l.marginBoY).toBeUndefined();
    expect(l.marginEoY).toBeCloseTo(100_000, 2);
  });

  it("year 2 charges 8% on the borrowed $100K and borrows again", () => {
    const y2 = at(runBorrow([BORROWER]), 2027);
    const l = y2.accountLedgers["acct-borrow"];
    expect(l.marginInterest).toBeCloseTo(8_000, 2);
    expect(l.marginEoY).toBeCloseTo(208_000, 2);
  });

  it("draws other cash first, then borrows", () => {
    const savings: Account = { ...CHECKING, id: "acct-savings", name: "Savings", subType: "savings", value: 30_000, basis: 30_000, isDefaultChecking: false };
    const y1 = at(runBorrow([savings, BORROWER]), 2026);
    expect(y1.withdrawals.byAccount["acct-savings"]).toBeCloseTo(30_000, 2);
    expect(y1.withdrawals.borrowedByAccount?.["acct-borrow"]).toBeCloseTo(70_000, 2);
  });

  it("the cap: borrows to 50% of the securities, sells the rest at the securities' gain ratio (Review Focus 1)", () => {
    const capped = { ...BORROWER, marginBalance: 450_000, marginInterestRate: 0 };
    const y1 = at(runBorrow([capped], { planSettings: { flatFederalRate: 0.22, flatStateRate: 0.05 } }), 2026);
    const l = y1.accountLedgers["acct-borrow"];
    const borrowed = y1.withdrawals.borrowedByAccount!["acct-borrow"];
    const sold = y1.withdrawals.byAccount["acct-borrow"] - borrowed;
    expect(borrowed).toBeCloseTo(50_000, 2);
    expect(sold).toBeGreaterThanOrEqual(50_000 - 0.01);
    expect(l.withdrawalDetail!.realizedLtcg / sold).toBeCloseTo(0.6, 6);
  });

  it("the loan grows by exactly the borrowed amount, however many times the year re-plans (Review Focus 2)", () => {
    const capped = { ...BORROWER, marginBalance: 450_000, marginInterestRate: 0 };
    const y1 = at(runBorrow([capped], { planSettings: { flatFederalRate: 0.22, flatStateRate: 0.05 } }), 2026);
    expect(y1.accountLedgers["acct-borrow"].marginEoY).toBeCloseTo(500_000, 6);
  });

  it("borrows only inside [Borrow from, Repay in)", () => {
    const years = runBorrow([{ ...BORROWER, marginBorrowStartYear: 2027, marginRepayYear: 2028 }], { years: 3 });
    expect(at(years, 2026).withdrawals.borrowedByAccount).toBeUndefined();
    expect(at(years, 2027).withdrawals.borrowedByAccount?.["acct-borrow"]).toBeCloseTo(100_000, 2);
    expect(at(years, 2028).withdrawals.borrowedByAccount).toBeUndefined();
  });

  it("the legacy no-checking path never borrows", () => {
    const y1 = runMargin([BORROWER], 1, { flatFederalRate: 0, flatStateRate: 0 }, { expenses: [spending(100_000)] })[0];
    expect(y1.withdrawals.borrowedByAccount).toBeUndefined();
    expect(y1.withdrawals.byAccount["acct-borrow"]).toBeGreaterThan(0);
  });

  it("switch off ⇒ identical to an account without the Phase 2 fields", () => {
    const { marginBorrowEnabled: _e, ...plain } = BORROWER;
    expect(runBorrow([{ ...BORROWER, marginBorrowEnabled: false }])).toEqual(runBorrow([plain]));
  });
});

describe("interest on borrowing for spending is personal", () => {
  it("example A year 2: all $8,000 of interest is personal", () => {
    const l = at(runBorrow([BORROWER]), 2027).accountLedgers["acct-borrow"];
    expect(l.marginInterestPersonal).toBeCloseTo(8_000, 2);
  });
  it("a Phase 1 loan with no borrowing has no personal interest", () => {
    const l = at(runBorrow([{ ...BORROWER, marginBalance: 200_000, marginBorrowEnabled: false }], { spend: 0 }), 2027)
      .accountLedgers["acct-borrow"];
    expect(l.marginInterest).toBeGreaterThan(0);
    expect(l.marginInterestPersonal).toBeUndefined();
  });
});
