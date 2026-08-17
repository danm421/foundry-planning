import { describe, it, expect } from "vitest";
import { applyEquityYear } from "../apply";
import type { EquityYearResult } from "../tax-events";

function res(over: Partial<EquityYearResult> = {}): EquityYearResult {
  return { ordinaryIncome: 0, ficaExemptOrdinaryIncome: 0, isoSpread: 0, capitalGains: 0, stCapitalGains: 0, strikeCashOutflow: 0, sellProceeds: 0, sellToCoverProceeds: 0, acquisitions: [], saleBasisRemoved: 0, details: [], ...over };
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

  // ── Audit F31: the destination can hold less than the module thinks it sold
  // (a supplemental withdrawal may have liquidated part of it). The old
  // `Math.max(0, …)` floored the debit while the caller still credited the full
  // proceeds — cash out of nothing. Drain what is there; report the rest.
  describe("under-funded destination", () => {
    it("drains only what the destination holds and withholds the unbacked cash", () => {
      const balances: Record<string, number> = { dest: 100_000 };
      const basis: Record<string, number> = { dest: 80_000 };
      const out = applyEquityYear(
        res({ sellProceeds: 146_410, saleBasisRemoved: 110_000, capitalGains: 36_410 }),
        "dest", balances, basis,
      );
      expect(balances.dest).toBe(0);
      expect(out.sellProceedsApplied).toBe(100_000);
      // Only the backed portion is credited: the unbacked $46,410 already
      // reached the household when the destination was drawn down.
      expect(out.netCashToChecking).toBe(100_000);
    });

    it("conserves value — the destination's loss equals the cash credited", () => {
      const balances: Record<string, number> = { dest: 100_000 };
      const basis: Record<string, number> = { dest: 80_000 };
      const before = balances.dest;
      const out = applyEquityYear(
        res({ sellProceeds: 146_410, saleBasisRemoved: 110_000 }),
        "dest", balances, basis,
      );
      expect(before - balances.dest).toBe(out.netCashToChecking);
    });

    it("never drives the destination negative, and never floors a negative balance to zero", () => {
      const balances: Record<string, number> = { dest: -40_000 };
      const basis: Record<string, number> = { dest: 0 };
      const out = applyEquityYear(
        res({ sellProceeds: 146_410, saleBasisRemoved: 110_000 }),
        "dest", balances, basis,
      );
      // Nothing to sell: the balance is untouched (NOT raised to 0) and no
      // cash is credited.
      expect(balances.dest).toBe(-40_000);
      expect(out.sellProceedsApplied).toBe(0);
      expect(out.netCashToChecking).toBe(0);
    });

    it("drains basis down to zero but never lifts it", () => {
      // Two cases in one: from a positive basis the drain floors at 0 (the old
      // clamp did this too), but a basis already below zero must be left alone
      // rather than raised to 0 — the same manufacture-from-nothing the value
      // leg used to do.
      const short: Record<string, number> = { dest: 20_000 };
      applyEquityYear(
        res({ sellProceeds: 146_410, saleBasisRemoved: 110_000 }),
        "dest", { dest: 100_000 }, short,
      );
      expect(short.dest).toBe(0);

      const negative: Record<string, number> = { dest: -5_000 };
      applyEquityYear(
        res({ sellProceeds: 146_410, saleBasisRemoved: 110_000 }),
        "dest", { dest: 100_000 }, negative,
      );
      expect(negative.dest).toBe(-5_000);
    });

    it("leaves a fully-funded sale untouched", () => {
      // Regression guard: the reconciliation must be inert in the normal case.
      const balances: Record<string, number> = { dest: 200_000 };
      const basis: Record<string, number> = { dest: 150_000 };
      const out = applyEquityYear(
        res({ sellProceeds: 146_410, saleBasisRemoved: 110_000 }),
        "dest", balances, basis,
      );
      expect(balances.dest).toBeCloseTo(53_590, 6);
      expect(basis.dest).toBeCloseTo(40_000, 6);
      expect(out.sellProceedsApplied).toBe(146_410);
      expect(out.netCashToChecking).toBe(146_410);
    });
  });
});
