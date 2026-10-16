import { describe, it, expect } from "vitest";
import { validateMarginFields } from "../margin-validation";

const ok = { category: "taxable", value: 10_000_000, marginBalance: 2_000_000, marginInterestRate: 0.02, marginCallPct: 0.3 };

describe("validateMarginFields", () => {
  it("accepts a valid margined taxable account", () => {
    expect(validateMarginFields(ok)).toBeNull();
  });
  it("accepts a non-taxable account with no loan", () => {
    expect(validateMarginFields({ ...ok, category: "retirement", marginBalance: 0 })).toBeNull();
  });
  it("rejects a loan on a non-taxable account", () => {
    expect(validateMarginFields({ ...ok, category: "cash" })).toMatch(/Remove the margin loan before changing the account type/);
  });
  it("rejects a loan at or above value", () => {
    expect(validateMarginFields({ ...ok, marginBalance: 10_000_000 })).toMatch(/less than the account's value/);
  });
  it("rejects a negative loan", () => {
    expect(validateMarginFields({ ...ok, marginBalance: -1 })).toMatch(/can't be negative/);
  });
  it("rejects a rate above 25%", () => {
    expect(validateMarginFields({ ...ok, marginInterestRate: 0.26 })).toMatch(/between 0% and 25%/);
  });
  it("rejects a margin call level of 0 or 1", () => {
    expect(validateMarginFields({ ...ok, marginCallPct: 0 })).toMatch(/between 0% and 100%/);
    expect(validateMarginFields({ ...ok, marginCallPct: 1 })).toMatch(/between 0% and 100%/);
  });
});

describe("borrowing on margin (Phase 2)", () => {
  const okBorrow = { category: "taxable", value: 1_000_000, marginBalance: 0, marginInterestRate: 0.08, marginCallPct: 0.3 };
  it("accepts the switch on a taxable account with no years", () => {
    expect(validateMarginFields({ ...okBorrow, marginBorrowEnabled: true })).toBeNull();
  });
  it("rejects the switch on a non-taxable account", () => {
    expect(validateMarginFields({ ...okBorrow, category: "cash", marginBorrowEnabled: true })).toBe(
      "Only taxable brokerage accounts can borrow on margin. Turn off borrowing before changing the account type.",
    );
  });
  it("rejects a repay year at or before borrow-from when the switch is on", () => {
    expect(validateMarginFields({ ...okBorrow, marginBorrowEnabled: true, marginBorrowStartYear: 2030, marginRepayYear: 2030 }))
      .toBe("The repay year must be after the year borrowing starts.");
  });
  it("accepts a repay year after borrow-from", () => {
    expect(validateMarginFields({ ...okBorrow, marginBorrowEnabled: true, marginBorrowStartYear: 2030, marginRepayYear: 2031 })).toBeNull();
  });
  it("ignores the year order with the switch off (a repay year pays off a pre-existing loan)", () => {
    expect(validateMarginFields({ ...okBorrow, marginBalance: 200_000, marginBorrowStartYear: 2035, marginRepayYear: 2030 })).toBeNull();
  });
  it("reads string years the way the write core holds them", () => {
    expect(validateMarginFields({ ...okBorrow, marginBorrowEnabled: true, marginBorrowStartYear: "2030", marginRepayYear: "2029" }))
      .toBe("The repay year must be after the year borrowing starts.");
  });
});
