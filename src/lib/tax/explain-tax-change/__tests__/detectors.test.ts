// src/lib/tax/explain-tax-change/__tests__/detectors.test.ts
import { describe, expect, it } from "vitest";
import { diffTaxYears } from "../diff";
import { detectWithdrawalShift, type DetectorArgs } from "../detectors";
import { DRILL_CTX, makeLedger, makeTaxDetail, makeYear } from "./fixtures";

function args(prev: ReturnType<typeof makeYear>, next: ReturnType<typeof makeYear>): DetectorArgs {
  return { prev, next, diff: diffTaxYears(prev, next, DRILL_CTX), ctx: DRILL_CTX, firstDeathYear: null, secondDeathYear: null };
}

describe("detectWithdrawalShift", () => {
  const depletedPrev = () =>
    makeYear({
      year: 2062,
      withdrawals: { byAccount: { brok: 120_000 }, total: 120_000 },
      accountLedgers: { brok: makeLedger({ beginningValue: 118_000, endingValue: 0 }) },
      taxDetail: makeTaxDetail({ "withdrawal:brok": { type: "capGains", amount: 20_000 } }),
    });
  const shiftedNext = () =>
    makeYear({
      year: 2063,
      withdrawals: { byAccount: { ira: 190_000 }, total: 190_000 },
      accountLedgers: { ira: makeLedger({ beginningValue: 900_000, endingValue: 750_000 }) },
      taxDetail: makeTaxDetail({ "withdrawal:ira": { type: "ordinary", amount: 190_000 } }),
    });

  it("fires when a depleted account's draws shift to a pre-tax account", () => {
    const f = detectWithdrawalShift(args(depletedPrev(), shiftedNext()));
    expect(f?.kind).toBe("withdrawal_shift");
    // recognized withdrawal income: 190k (ira) − 20k (brok) = 170k
    expect(f?.incomeDelta).toBe(170_000);
    expect(f?.summary).toContain("Joint Brokerage");
    expect(f?.summary).toContain("Dan IRA");
    expect(f?.evidence.grossWithdrawalDelta).toBe(70_000);
  });

  it("returns null when nothing depleted (draws just grew)", () => {
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { brok: 50_000 }, total: 50_000 },
      accountLedgers: { brok: makeLedger({ beginningValue: 500_000, endingValue: 460_000 }) },
    });
    expect(detectWithdrawalShift(args(prev, shiftedNext()))).toBeNull();
  });

  it("returns null when no account's draws rose", () => {
    const next = makeYear({ year: 2063, withdrawals: { byAccount: {}, total: 0 } });
    expect(detectWithdrawalShift(args(depletedPrev(), next))).toBeNull();
  });

  it("states the direction correctly when total gross withdrawals fell despite the shift", () => {
    // A third account's draws fall by more than the riser gained, so
    // totalWithdrawals.delta goes negative even though the depleted->riser
    // shift still recognizes more taxable income.
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { brok: 120_000, third: 200_000 }, total: 320_000 },
      accountLedgers: {
        brok: makeLedger({ beginningValue: 118_000, endingValue: 0 }),
        third: makeLedger({ beginningValue: 3_200_000, endingValue: 3_000_000 }),
      },
      taxDetail: makeTaxDetail({ "withdrawal:brok": { type: "capGains", amount: 20_000 } }),
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { ira: 190_000, third: 50_000 }, total: 240_000 },
      accountLedgers: {
        ira: makeLedger({ beginningValue: 900_000, endingValue: 750_000 }),
        third: makeLedger({ beginningValue: 3_000_000, endingValue: 2_950_000 }),
      },
      taxDetail: makeTaxDetail({ "withdrawal:ira": { type: "ordinary", amount: 190_000 } }),
    });

    const f = detectWithdrawalShift(args(prev, next));
    expect(f?.kind).toBe("withdrawal_shift");
    expect(f?.evidence.grossWithdrawalDelta).toBe(-80_000);
    expect(f?.summary).toContain("fell");
    expect(f?.summary).not.toContain("rose");
  });

  it("returns null when recognized income delta is below LINE_FLOOR despite a depleted account and a riser", () => {
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { ira: 15_000 }, total: 15_000 },
      taxDetail: makeTaxDetail({ "withdrawal:ira": { type: "ordinary", amount: 20_050 } }),
    });
    expect(detectWithdrawalShift(args(depletedPrev(), next))).toBeNull();
  });
});
