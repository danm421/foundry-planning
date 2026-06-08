import { describe, it, expect } from "vitest";
import { applyEquityYear } from "../apply";
import type { EquityYearResult } from "../tax-events";

function res(over: Partial<EquityYearResult> = {}): EquityYearResult {
  return { ordinaryIncome: 0, isoSpread: 0, capitalGains: 0, stCapitalGains: 0, strikeCashOutflow: 0, sellProceeds: 0, sellToCoverProceeds: 0, acquisitions: [], saleBasisRemoved: 0, ...over };
}

describe("applyEquityYear", () => {
  it("adds acquisition value+basis to the destination account", () => {
    const balances: Record<string, number> = { dest: 0, chk: 1000 };
    const basis: Record<string, number> = { dest: 0 };
    const out = applyEquityYear(res({ acquisitions: [{ value: 7500, basis: 7500 }] }), "dest", balances, basis);
    expect(balances.dest).toBe(7500);
    expect(basis.dest).toBe(7500);
    expect(out.taxDeltas.ordinaryIncome).toBe(0);
  });

  it("drains the destination on sale and reports net proceeds via netCashToChecking (no direct checking credit)", () => {
    const balances: Record<string, number> = { dest: 10000, chk: 0 };
    const basis: Record<string, number> = { dest: 6000 };
    const out = applyEquityYear(res({ sellProceeds: 4000, saleBasisRemoved: 2400, capitalGains: 1600 }), "dest", balances, basis);
    expect(balances.dest).toBe(6000);   // 10000 − 4000 proceeds (market value sold)
    expect(basis.dest).toBe(3600);      // 6000 − 2400 basis removed
    expect(balances.chk).toBe(0);       // checking untouched — caller routes cash via creditCash
    expect(out.netCashToChecking).toBe(4000); // proceeds reported for the caller to credit
    expect(out.taxDeltas.capitalGains).toBe(1600);
  });

  it("nets strike outflow and sell-to-cover proceeds into netCashToChecking (no direct checking credit)", () => {
    const balances: Record<string, number> = { dest: 0, chk: 5000 };
    const basis: Record<string, number> = { dest: 0 };
    const out = applyEquityYear(
      res({ acquisitions: [{ value: 9000, basis: 1000 }], strikeCashOutflow: 1000, sellToCoverProceeds: 0, ordinaryIncome: 9000, isoSpread: 0 }),
      "dest", balances, basis,
    );
    expect(balances.chk).toBe(5000);       // checking untouched — caller routes cash via creditCash
    expect(out.netCashToChecking).toBe(-1000); // −1000 strike reported for the caller to debit
    expect(out.taxDeltas.ordinaryIncome).toBe(9000);
  });
});
