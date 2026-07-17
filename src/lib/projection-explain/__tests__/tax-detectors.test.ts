// src/lib/projection-explain/__tests__/tax-detectors.test.ts
import { describe, expect, it } from "vitest";
import { diffTaxYears } from "../subjects/tax-diff";
import {
  DETECTORS,
  detectDeductionChange,
  detectFilingStatusChange,
  detectFundingCharacterShift,
  detectRealizedGains,
  detectRmdChange,
  detectRothConversion,
  detectSocialSecurity,
  detectStateMove,
  type DetectorArgs,
  type RatioAccount,
} from "../subjects/tax-detectors";
import { DRILL_CTX, makeLedger, makeTaxDetail, makeTaxResult, makeYear } from "./fixtures";
import type { StateIncomeTaxResult } from "@/lib/tax/state-income/types";
import type { Account } from "@/engine/types";
import type { DrillContext } from "../types";

function args(prev: ReturnType<typeof makeYear>, next: ReturnType<typeof makeYear>): DetectorArgs {
  return { prev, next, diff: diffTaxYears(prev, next, DRILL_CTX), ctx: DRILL_CTX, firstDeathYear: null, secondDeathYear: null };
}

/** Build a DrillContext whose accountNames + accounts cover the given accounts,
 *  so both the funding rows (name lookup) and ratio classification resolve. */
function ctxWith(accts: Array<Partial<Account>>): DrillContext {
  return {
    ...DRILL_CTX,
    accountNames: Object.fromEntries(accts.map((a) => [a.id!, a.name!])),
    accounts: accts as unknown as Account[],
  };
}

function argsWithCtx(
  prev: ReturnType<typeof makeYear>,
  next: ReturnType<typeof makeYear>,
  ctx: DrillContext,
): DetectorArgs {
  return { prev, next, diff: diffTaxYears(prev, next, ctx), ctx, firstDeathYear: null, secondDeathYear: null };
}

describe("detectFundingCharacterShift", () => {
  // Cooper-shaped: prior-year funding is a mixed-Roth Client 401k (~0.44 taxable);
  // the asked year shifts to an all-pre-tax Spouse 401k (1.0), while a taxable
  // brokerage that ran to $0 keeps drawing a residual (the depletion flag).
  function cooperDetectorArgs(): DetectorArgs {
    const ctx = ctxWith([
      { id: "c401k", name: "Client 401k", category: "retirement", subType: "401k" },
      { id: "s401k", name: "Spouse 401k", category: "retirement", subType: "401k" },
      { id: "brok", name: "Joint Brokerage", category: "taxable", subType: "brokerage" },
    ]);
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { c401k: 200_000, brok: 100_000 }, total: 300_000 },
      accountLedgers: {
        c401k: makeLedger({ beginningValue: 500_000, endingValue: 300_000, rothValueBoY: 250_000 }),
        brok: makeLedger({ beginningValue: 100_000, endingValue: 0 }),
      },
      taxDetail: makeTaxDetail({
        "withdrawal:c401k": { type: "ordinary", amount: 88_000 },
        "withdrawal:brok": { type: "capGains", amount: 10_000 },
      }),
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { c401k: 20_000, s401k: 250_000, brok: 5_000 }, total: 275_000 },
      accountLedgers: {
        c401k: makeLedger({ beginningValue: 300_000, endingValue: 280_000, rothValueBoY: 150_000 }),
        s401k: makeLedger({ beginningValue: 800_000, endingValue: 550_000 }),
        brok: makeLedger({ beginningValue: 0, endingValue: 0 }),
      },
      taxDetail: makeTaxDetail({
        "withdrawal:c401k": { type: "ordinary", amount: 8_800 },
        "withdrawal:s401k": { type: "ordinary", amount: 250_000 },
        "withdrawal:brok": { type: "capGains", amount: 500 },
      }),
    });
    return argsWithCtx(prev, next, ctx);
  }

  // Pure strategy reorder: draws move from a Roth IRA (tax-free) to a pre-tax
  // IRA, so the blended recognition ratio climbs — but no account hits $0.
  function ratioShiftNoDepletionArgs(): DetectorArgs {
    const ctx = ctxWith([
      { id: "rira", name: "Client Roth IRA", category: "retirement", subType: "roth_ira" },
      { id: "tira", name: "Client IRA", category: "retirement", subType: "traditional_ira" },
    ]);
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { rira: 100_000, tira: 20_000 }, total: 120_000 },
      accountLedgers: {
        rira: makeLedger({ beginningValue: 400_000, endingValue: 300_000 }),
        tira: makeLedger({ beginningValue: 500_000, endingValue: 480_000 }),
      },
      taxDetail: makeTaxDetail({ "withdrawal:tira": { type: "ordinary", amount: 20_000 } }),
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { rira: 20_000, tira: 100_000 }, total: 120_000 },
      accountLedgers: {
        rira: makeLedger({ beginningValue: 300_000, endingValue: 280_000 }),
        tira: makeLedger({ beginningValue: 480_000, endingValue: 380_000 }),
      },
      taxDetail: makeTaxDetail({ "withdrawal:tira": { type: "ordinary", amount: 100_000 } }),
    });
    return argsWithCtx(prev, next, ctx);
  }

  it("fires funding_character_shift when the blended recognition ratio jumps (Cooper-shaped)", () => {
    const a = cooperDetectorArgs();
    const f = detectFundingCharacterShift(a)!;
    expect(f.kind).toBe("funding_character_shift");
    expect(f.incomeDelta).toBeGreaterThan(0);
    const rows = f.detail!.accounts as RatioAccount[];
    expect(rows.find((r) => r.account.includes("Client 401k"))!.ratioReason).toBe("roth_designated_slice");
    expect(rows.find((r) => r.account.includes("Spouse 401k"))!.ratioReason).toBe("fully_pretax");
    expect(rows.find((r) => r.depleted)).toBeTruthy();
    // ratioPrev (~0.33) counts the mixed-Roth Client 401k that dominated 2062;
    // ratioNext (~0.94) reflects the pre-tax Spouse 401k. The jump is real.
    expect(f.evidence.blendedRatioPriorYear as number).toBeLessThan(0.5);
    expect(f.evidence.blendedRatioYear as number).toBeGreaterThan(0.85);
  });

  it("fires without a depletion flag on a pure strategy reorder", () => {
    const a = ratioShiftNoDepletionArgs();
    const f = detectFundingCharacterShift(a)!;
    expect(f.kind).toBe("funding_character_shift");
    expect((f.detail!.accounts as RatioAccount[]).some((r) => r.depleted)).toBe(false);
    expect(f.summary).toContain("reorder");
  });

  it("counts a prior-year-only funder (dropped from the asked-year rows) in the prior blended ratio", () => {
    // Client 401k funds 2062 at 0.44 then depletes; 2063 draws entirely from
    // Spouse 401k. Client 401k has no asked-year cashOut, so Task 3's byAccount
    // filter drops it — iterating byAccount for recPrev would read the prior
    // ratio as 0. The detector must sum recognized over the PRIOR funding set.
    const ctx = ctxWith([
      { id: "c401k", name: "Client 401k", category: "retirement", subType: "401k" },
      { id: "s401k", name: "Spouse 401k", category: "retirement", subType: "401k" },
    ]);
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { c401k: 100_000 }, total: 100_000 },
      accountLedgers: {
        c401k: makeLedger({ beginningValue: 100_000, endingValue: 0 }),
        s401k: makeLedger({ beginningValue: 800_000, endingValue: 800_000 }),
      },
      taxDetail: makeTaxDetail({ "withdrawal:c401k": { type: "ordinary", amount: 44_000 } }),
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { s401k: 100_000 }, total: 100_000 },
      accountLedgers: { s401k: makeLedger({ beginningValue: 800_000, endingValue: 700_000 }) },
      taxDetail: makeTaxDetail({ "withdrawal:s401k": { type: "ordinary", amount: 100_000 } }),
    });
    const f = detectFundingCharacterShift(argsWithCtx(prev, next, ctx))!;
    // 44k recognized on 100k prior funding — NOT 0.
    expect(f.evidence.blendedRatioPriorYear).toBe(0.44);
    expect(f.evidence.blendedRatioYear).toBe(1);
  });

  it("excludes a withdrawal_tax_free slice from the recognized amount (tax-ledger semantics)", () => {
    // Newly-landed engine key: `withdrawal_tax_free:<id>` carries the tax-free
    // portion of a partially-taxable draw. recognizedForAccount sums only the
    // named taxable keys, so the blended ratio stays below the gross-based 1.0.
    const ctx = ctxWith([
      { id: "mix", name: "Mixed account", category: "retirement", subType: "traditional_ira" },
    ]);
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { mix: 100_000 }, total: 100_000 },
      accountLedgers: { mix: makeLedger({ beginningValue: 500_000, endingValue: 400_000 }) },
      taxDetail: makeTaxDetail({ "withdrawal:mix": { type: "ordinary", amount: 100_000 } }),
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { mix: 100_000 }, total: 100_000 },
      accountLedgers: { mix: makeLedger({ beginningValue: 400_000, endingValue: 300_000 }) },
      taxDetail: makeTaxDetail({
        "withdrawal:mix": { type: "ordinary", amount: 60_000 },
        "withdrawal_tax_free:mix": { type: "taxExempt", amount: 40_000 },
      }),
    });
    const f = detectFundingCharacterShift(argsWithCtx(prev, next, ctx))!;
    const mixRow = (f.detail!.accounts as RatioAccount[]).find((r) => r.accountId === "mix")!;
    // 60k taxable, NOT the 100k gross draw — the 40k tax-free slice is excluded.
    expect(mixRow.recognized).toBe(60_000);
    expect(mixRow.ratio).toBeCloseTo(0.6);
    // A gross-based ratio would read 100k/100k = 1.0; named-keys-only keeps it lower.
    expect(f.evidence.blendedRatioYear).toBe(0.6);
    expect(f.evidence.blendedRatioYear as number).toBeLessThan(1);
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

  it("includes business_sale gains from a business-cascade sale", () => {
    // The engine writes `business_sale:${transactionId}` capital-gain entries
    // into taxDetail.bySource (src/engine/projection.ts) for a business-cascade
    // sale — isGainKey must recognize this prefix, not just `sale:`.
    const prev = makeYear({ year: 2062 });
    const next = makeYear({
      year: 2063,
      taxDetail: makeTaxDetail({
        "business_sale:tx9": { type: "capGains", amount: 120_000 },
      }),
    });
    const f = detectRealizedGains(args(prev, next));
    expect(f?.kind).toBe("realized_gains");
    expect(f?.incomeDelta).toBe(120_000);
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
