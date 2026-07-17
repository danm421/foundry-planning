// src/lib/tax/explain-tax-change/__tests__/detectors.test.ts
import { describe, expect, it } from "vitest";
import { diffTaxYears } from "../diff";
import {
  DETECTORS,
  detectDeductionChange,
  detectFilingStatusChange,
  detectRealizedGains,
  detectRmdChange,
  detectRothConversion,
  detectSocialSecurity,
  detectStateMove,
  detectWithdrawalShift,
  type DetectorArgs,
} from "../detectors";
import { DRILL_CTX, makeLedger, makeTaxDetail, makeTaxResult, makeYear } from "./fixtures";
import type { StateIncomeTaxResult } from "@/lib/tax/state-income/types";

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

describe("detectRmdChange", () => {
  it("flags RMD onset with per-account detail", () => {
    const prev = makeYear({ year: 2062 });
    const next = makeYear({
      year: 2063,
      accountLedgers: { ira: makeLedger({ rmdAmount: 42_000 }) },
    });
    const f = detectRmdChange(args(prev, next));
    expect(f?.kind).toBe("rmd");
    expect(f?.incomeDelta).toBe(42_000);
    expect(f?.summary).toContain("began");
    expect(f?.summary).toContain("Dan IRA");
  });
  it("returns null when RMDs are flat", () => {
    const y = (year: number) =>
      makeYear({ year, accountLedgers: { ira: makeLedger({ rmdAmount: 40_000 }) } });
    expect(detectRmdChange(args(y(2062), y(2063)))).toBeNull();
  });
});

describe("detectRothConversion", () => {
  it("flags a conversion year", () => {
    const prev = makeYear({ year: 2062 });
    const next = makeYear({
      year: 2063,
      rothConversions: [{ id: "rc1", name: "Fill 24% bracket", gross: 100_000, taxable: 95_000 }],
    });
    const f = detectRothConversion(args(prev, next));
    expect(f?.incomeDelta).toBe(95_000);
  });
});

describe("detectSocialSecurity", () => {
  it("flags a taxability push even when gross SS is unchanged", () => {
    const prev = makeYear({
      year: 2062,
      income: { ...makeYear({ year: 2062 }).income, socialSecurity: 60_000 },
      taxResult: makeTaxResult({ income: { taxableSocialSecurity: 20_000 } }),
    });
    const next = makeYear({
      year: 2063,
      income: { ...makeYear({ year: 2063 }).income, socialSecurity: 60_000 },
      taxResult: makeTaxResult({ income: { taxableSocialSecurity: 51_000 } }),
    });
    const f = detectSocialSecurity(args(prev, next));
    expect(f?.incomeDelta).toBe(31_000);
    expect(f?.summary).toContain("taxab");
  });
});

describe("detectRealizedGains", () => {
  it("sums sale/equity/note gain keys, ignoring withdrawal keys", () => {
    const prev = makeYear({ year: 2062 });
    const next = makeYear({
      year: 2063,
      taxDetail: makeTaxDetail({
        "sale:tx1": { type: "capGains", amount: 80_000 },
        "withdrawal:ira": { type: "ordinary", amount: 50_000 },
      }),
    });
    const f = detectRealizedGains(args(prev, next));
    expect(f?.incomeDelta).toBe(80_000);
  });
});

describe("detectFilingStatusChange", () => {
  it("fires when a death lands between the two years", () => {
    const prev = makeYear({ year: 2062 });
    const next = makeYear({ year: 2063 });
    const f = detectFilingStatusChange({ ...args(prev, next), firstDeathYear: 2063 });
    expect(f?.kind).toBe("filing_status_change");
    expect(f?.incomeDelta).toBe(0);
  });
  it("stays quiet when deaths are elsewhere", () => {
    const f = detectFilingStatusChange({ ...args(makeYear({ year: 2062 }), makeYear({ year: 2063 })), firstDeathYear: 2070 });
    expect(f).toBeNull();
  });
});

describe("detectDeductionChange", () => {
  it("reports deductions falling as a positive taxable-income impact", () => {
    const prev = makeYear({ year: 2062, taxResult: makeTaxResult({ flow: { belowLineDeductions: 45_000 } }) });
    const next = makeYear({ year: 2063, taxResult: makeTaxResult({ flow: { belowLineDeductions: 17_000 } }) });
    const f = detectDeductionChange(args(prev, next));
    expect(f?.incomeDelta).toBe(28_000);
  });
});

describe("detectStateMove", () => {
  const state = (code: string, stateTax: number) =>
    ({ state: code, stateTax } as unknown as StateIncomeTaxResult);
  it("fires on a residence-state change", () => {
    const prev = makeYear({ year: 2062, taxResult: makeTaxResult({ flow: { stateTax: 0 }, state: state("TX", 0) }) });
    const next = makeYear({ year: 2063, taxResult: makeTaxResult({ flow: { stateTax: 22_000 }, state: state("CA", 22_000) }) });
    const f = detectStateMove(args(prev, next));
    expect(f?.kind).toBe("state_move");
    expect(f?.summary).toContain("TX");
    expect(f?.summary).toContain("CA");
  });
});

describe("DETECTORS", () => {
  it("exports all eight detectors", () => {
    expect(DETECTORS).toHaveLength(8);
  });
});
