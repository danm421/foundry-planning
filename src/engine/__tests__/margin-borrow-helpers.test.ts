// src/engine/__tests__/margin-borrow-helpers.test.ts
import { describe, it, expect } from "vitest";
import {
  shareAfterBorrow, shareAfterRepayment, settleShareAfterRepayment, marginBorrowHeadroom,
  canBorrowOnMargin, marginBorrowSourcesFor, borrowOnMargin, marginCallSaleAmount,
  sellSecuritiesToRepayLoan, marginCallWarnings, chargeMarginInterest, type MarginShareMap,
} from "../margin";
import type { Account, AccountLedger } from "../types";

const ledger = (v: number): AccountLedger => ({
  beginningValue: v, growth: 0, contributions: 0, distributions: 0, internalContributions: 0,
  internalDistributions: 0, rmdAmount: 0, fees: 0, endingValue: v, entries: [],
});
const brokerage = (over: Partial<Account> = {}): Account => ({
  id: "b", name: "Schwab Brokerage", category: "taxable", subType: "brokerage", titlingType: "jtwros",
  value: 1_000_000, basis: 400_000, growthRate: 0, rmdEnabled: false, owners: [],
  marginInterestRate: 0.08, marginCallPct: 0.3, marginBorrowEnabled: true, ...over,
});

describe("personal-use share math (spec 2026-10-14)", () => {
  it("borrowing for spending moves the share toward personal (example B)", () => {
    expect(shareAfterBorrow(0, 200_000, 100_000)).toBeCloseTo(1 / 3, 12);
    expect(shareAfterBorrow(0, 0, 100_000)).toBe(1);
  });
  it("repayment retires personal-use dollars first (example D)", () => {
    // loan 500k, 40% personal (200k); repay 266,666.67 → personal 0
    expect(shareAfterRepayment(0.4, 500_000, 266_666.67)).toBe(0);
    // loan 300k, 1/3 personal (100k); repay 50k → personal 50k of 250k
    expect(shareAfterRepayment(1 / 3, 300_000, 50_000)).toBeCloseTo(0.2, 12);
    expect(shareAfterRepayment(0.5, 100_000, 100_000)).toBe(0);
  });
  it("settle deletes the share when the loan is gone or personal-use is repaid", () => {
    const m: MarginShareMap = { a: 0.4, b: 1 / 3, c: 0.5 };
    settleShareAfterRepayment(m, "a", 500_000, 233_333.33);
    settleShareAfterRepayment(m, "b", 300_000, 250_000);
    settleShareAfterRepayment(m, "c", 100_000, 0);
    expect(m).toEqual({ b: expect.closeTo(0.2, 12) });
  });
  it("borrow, borrow, repay the personal part exactly ⇒ no share and no personal interest", () => {
    // Without a threshold the share comes back as 1.46e-16 of float residue.
    const balances = { b: 1_000_000 };
    const loans: Record<string, number> = { b: 100_000 };
    const shares: MarginShareMap = {};
    for (const amount of [12_345.67, 100_000]) {
      borrowOnMargin({ accountId: "b", amount, accountBalances: balances, marginMap: loans, shareMap: shares, ledger: undefined, checkingId: "chk" });
    }
    settleShareAfterRepayment(shares, "b", loans.b, loans.b - 112_345.67);
    expect(shares).toEqual({});
    const l = ledger(balances.b);
    chargeMarginInterest(brokerage(), balances, { b: 100_000 }, l, shares.b ?? 0);
    expect(l.marginInterestPersonal).toBeUndefined();
  });
});

describe("borrowing headroom and eligibility", () => {
  it("caps the loan at half the securities (example C)", () => {
    expect(marginBorrowHeadroom(1_000_000, 450_000, 0.3)).toBeCloseTo(50_000, 6);
  });
  it("a call level above 50% tightens the cap", () => {
    expect(marginBorrowHeadroom(1_000_000, 450_000, 0.6)).toBe(0);
    expect(marginBorrowHeadroom(1_000_000, 0, 0.6)).toBeCloseTo(400_000, 6);
  });
  it("only a household-owned Taxable account with the switch on, inside its window, borrows", () => {
    expect(canBorrowOnMargin(brokerage(), 2026, 1)).toBe(true);
    expect(canBorrowOnMargin(brokerage({ marginBorrowEnabled: false }), 2026, 1)).toBe(false);
    expect(canBorrowOnMargin(brokerage({ category: "cash" }), 2026, 1)).toBe(false);
    expect(canBorrowOnMargin(brokerage(), 2026, 0.5)).toBe(false);
    expect(canBorrowOnMargin(brokerage({ marginBorrowStartYear: 2027 }), 2026, 1)).toBe(false);
    expect(canBorrowOnMargin(brokerage({ marginBorrowStartYear: 2027 }), 2027, 1)).toBe(true);
    expect(canBorrowOnMargin(brokerage({ marginRepayYear: 2030 }), 2029, 1)).toBe(true);
    expect(canBorrowOnMargin(brokerage({ marginRepayYear: 2030 }), 2030, 1)).toBe(false);
  });
  it("sources come cheapest first, then most headroom", () => {
    const src = marginBorrowSourcesFor({
      accounts: [brokerage({ id: "x", marginInterestRate: 0.09 }), brokerage({ id: "y", marginInterestRate: 0.07 }), brokerage({ id: "z", marginInterestRate: 0.07 })],
      year: 2026, accountBalances: { x: 1_000_000, y: 100_000, z: 900_000 }, marginMap: {}, householdShareOf: () => 1,
    });
    expect(src.map((s) => s.accountId)).toEqual(["z", "y", "x"]);
    expect(src[0].headroom).toBeCloseTo(450_000, 6);
  });
});

describe("borrowOnMargin", () => {
  it("raises the loan, lowers net, leaves basis, books the entry, sets the share (example A)", () => {
    const balances = { b: 1_000_000 };
    const loans: Record<string, number> = {};
    const shares: MarginShareMap = {};
    const l = ledger(1_000_000);
    borrowOnMargin({ accountId: "b", amount: 100_000, accountBalances: balances, marginMap: loans, shareMap: shares, ledger: l, checkingId: "chk" });
    expect(balances.b).toBe(900_000);
    expect(loans.b).toBe(100_000);
    expect(shares.b).toBe(1);
    expect(l.distributions).toBe(100_000);
    expect(l.endingValue).toBe(900_000);
    expect(l.entries).toEqual([{ category: "margin_borrow", label: "Borrowed on margin", amount: -100_000, counterpartyId: "chk", basis: 0 }]);
  });
});

describe("chargeMarginInterest — the personal-use part (M1)", () => {
  it("a share notes the non-deductible part on the interest line, in whole dollars", () => {
    const l = ledger(800_000);
    const interest = chargeMarginInterest(brokerage(), { b: 800_000 }, { b: 200_000 }, l, 0.0771605);
    expect(interest).toBeCloseTo(16_000, 6);
    expect(l.marginInterestPersonal).toBeCloseTo(1_234.568, 3);
    expect(l.entries).toEqual([{ category: "margin_interest", amount: -16_000, basis: 0,
      label: "Margin interest (8.00%) — $1,235 not deductible (borrowed for spending)" }]);
  });
  it("no share ⇒ the plain label and no personal interest", () => {
    const l = ledger(800_000);
    chargeMarginInterest(brokerage(), { b: 800_000 }, { b: 200_000 }, l);
    expect(l.marginInterestPersonal).toBeUndefined();
    expect(l.entries[0].label).toBe("Margin interest (8.00%)");
  });
});

describe("margin calls and repayment sales", () => {
  it("sells just enough to restore the call level (example D)", () => {
    expect(marginCallSaleAmount(100_000, 500_000, 0.3)).toBeCloseTo(266_666.67, 2);
  });
  it("sells nothing when compliant, everything when underwater", () => {
    expect(marginCallSaleAmount(500_000, 500_000, 0.3)).toBe(0);
    expect(marginCallSaleAmount(-400_000, 900_000, 0.3)).toBeCloseTo(500_000, 6);
    expect(marginCallSaleAmount(100_000, 0, 0.3)).toBe(0);
  });
  it("sub-cent securities count as exhausted: no sale (I2)", () => {
    // The 2035 state of the margin-calls.test.ts I2 fixture: +9.1e-13 of
    // float residue after a sell-everything call.
    expect(marginCallSaleAmount(-3_089.5410463375365, 3_089.5410463375374, 0.3)).toBe(0);
    const loans: Record<string, number> = { b: 3_089.5410463375374 };
    const basis = { b: 0 };
    const l = ledger(-3_089.5410463375365);
    const sale = sellSecuritiesToRepayLoan({ acct: brokerage(), reason: "call", amount: 1e-12,
      accountBalances: { b: -3_089.5410463375365 }, basisMap: basis, freshBasisMap: {}, marginMap: loans, shareMap: {}, ledger: l });
    expect(sale).toBeNull();
    expect(loans.b).toBe(3_089.5410463375374);
    expect(l.entries).toEqual([]);
  });
  it("a just-restored ratio is compliant despite floating-point noise (R4)", () => {
    const sold = marginCallSaleAmount(100_000, 500_000, 0.3);
    expect(marginCallSaleAmount(100_000, 500_000 - sold, 0.3)).toBe(0);
    expect(marginCallWarnings([brokerage()], { b: 100_000 }, { b: 500_000 - sold })).toEqual([]);
  });
  it("a restored ratio that lands a hair BELOW the call level is still compliant (R4)", () => {
    // Node: sold = 460,711.3333333333, loan after = 39,288.666666666686,
    // net ÷ securities = 16,838 / 56,126.666666666686 = 0.2999999999999999 (< 0.3).
    // Without the tolerance the call check would order a ~1.46e-11 sale and warn.
    const sold = marginCallSaleAmount(16_838, 500_000, 0.3);
    expect(16_838 / (16_838 + 500_000 - sold)).toBeLessThan(0.3);
    expect(marginCallSaleAmount(16_838, 500_000 - sold, 0.3)).toBe(0);
    expect(marginCallWarnings([brokerage()], { b: 16_838 }, { b: 500_000 - sold })).toEqual([]);
  });
  it("example D: gain on the securities ratio, basis falls, net unchanged, personal-use repaid first", () => {
    const balances = { b: 100_000 };
    const basis = { b: 400_000 };
    const fresh: Record<string, number> = {};
    const loans: Record<string, number> = { b: 500_000 };
    const shares: MarginShareMap = { b: 0.4 };
    const l = ledger(100_000);
    const sale = sellSecuritiesToRepayLoan({ acct: brokerage(), reason: "call", amount: 266_666.67,
      accountBalances: balances, basisMap: basis, freshBasisMap: fresh, marginMap: loans, shareMap: shares, ledger: l });
    expect(sale).toEqual({ accountId: "b", reason: "call", sold: expect.closeTo(266_666.67, 2), gain: expect.closeTo(88_888.89, 2) });
    expect(balances.b).toBe(100_000);
    expect(loans.b).toBeCloseTo(233_333.33, 2);
    expect(basis.b).toBeCloseTo(222_222.22, 2);
    expect(shares.b).toBeUndefined();
    expect(l.entries.map((e) => [e.category, e.label])).toEqual([
      ["margin_sale", "Sold to meet margin call"], ["margin_paydown", "Margin loan paid down"],
    ]);
    expect(l.entries[0].amount + l.entries[1].amount).toBeCloseTo(0, 6);
    expect(l.entries[0].basis).toBeCloseTo(-177_777.78, 2);
  });
  it("example E: a repay sale clears the loan and deletes it from the map", () => {
    const loans: Record<string, number> = { b: 300_000 };
    const basis = { b: 500_000 };
    const sale = sellSecuritiesToRepayLoan({ acct: brokerage(), reason: "repay", amount: 300_000,
      accountBalances: { b: 900_000 }, basisMap: basis, freshBasisMap: {}, marginMap: loans, shareMap: {}, ledger: undefined });
    expect(sale?.gain).toBeCloseTo(175_000, 2);
    expect(basis.b).toBeCloseTo(375_000, 2);
    expect("b" in loans).toBe(false);
  });
  it("underwater: sells every security, the rest of the loan stays", () => {
    const loans: Record<string, number> = { b: 900_000 };
    const balances = { b: -400_000 };
    const sale = sellSecuritiesToRepayLoan({ acct: brokerage(), reason: "call", amount: 500_000,
      accountBalances: balances, basisMap: { b: 400_000 }, freshBasisMap: {}, marginMap: loans, shareMap: {}, ledger: undefined });
    expect(sale?.sold).toBeCloseTo(500_000, 6);
    expect(sale?.gain).toBeCloseTo(100_000, 6);
    expect(loans.b).toBeCloseTo(400_000, 6);
    expect(balances.b).toBe(-400_000);
  });
});
