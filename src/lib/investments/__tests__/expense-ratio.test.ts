import { describe, it, expect } from "vitest";
import { expenseRatioFromPayload } from "@/lib/investments/expense-ratio";

// Values below are copied from real rows on the dev branch (2026-08-12).
// They are the regression guard for the ETF-decimal / mutual-fund-percent
// mismatch: read naively, DBLTX would report as 50%, not 0.50%.
describe("expenseRatioFromPayload", () => {
  it("reads an ETF NetExpenseRatio as a decimal fraction", () => {
    const raw = { ETF_Data: { NetExpenseRatio: "0.00030" } };
    expect(expenseRatioFromPayload(raw, "etf")).toBeCloseTo(0.0003, 10);
  });

  it("converts a mutual fund Expense_Ratio from percent", () => {
    const raw = { MutualFund_Data: { Expense_Ratio: "0.5000" } };
    expect(expenseRatioFromPayload(raw, "mutual_fund")).toBeCloseTo(0.005, 10);
  });

  it("keeps an ETF and a mutual fund on the same scale", () => {
    // SPY 0.095% vs MIPTX 1.10% — the mutual fund must be the more expensive
    // of the two by roughly 11x, not by roughly 1000x.
    const spy = expenseRatioFromPayload({ ETF_Data: { NetExpenseRatio: "0.00095" } }, "etf")!;
    const miptx = expenseRatioFromPayload({ MutualFund_Data: { Expense_Ratio: "1.1000" } }, "mutual_fund")!;
    expect(miptx / spy).toBeGreaterThan(10);
    expect(miptx / spy).toBeLessThan(13);
  });

  it("treats a fund zero as unknown, not free", () => {
    expect(expenseRatioFromPayload({ ETF_Data: { NetExpenseRatio: "0.00000" } }, "etf")).toBeNull();
  });

  it("never falls back to Ongoing_Charge", () => {
    // Ongoing_Charge is zero-filled for most major ETFs. Falling back to it
    // would print "0.00% expense ratio" for VTI, AGG, QQQ and friends.
    const raw = { ETF_Data: { Ongoing_Charge: "0.0000", Max_Annual_Mgmt_Charge: "0.00" } };
    expect(expenseRatioFromPayload(raw, "etf")).toBeNull();
  });

  it("returns a true zero for individual stocks and bonds", () => {
    expect(expenseRatioFromPayload({ General: {} }, "stock")).toBe(0);
    expect(expenseRatioFromPayload({ General: {} }, "bond")).toBe(0);
  });

  it("returns null for a missing or malformed payload", () => {
    expect(expenseRatioFromPayload(null, "etf")).toBeNull();
    expect(expenseRatioFromPayload({}, "etf")).toBeNull();
    expect(expenseRatioFromPayload({ ETF_Data: { NetExpenseRatio: "n/a" } }, "etf")).toBeNull();
  });

  it("rejects an implausibly large ratio rather than reporting it", () => {
    expect(expenseRatioFromPayload({ ETF_Data: { NetExpenseRatio: "0.9" } }, "etf")).toBeNull();
  });
});
