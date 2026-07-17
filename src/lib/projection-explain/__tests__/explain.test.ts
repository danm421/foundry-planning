// src/lib/projection-explain/__tests__/explain.test.ts
import { describe, expect, it } from "vitest";
import { explainChange } from "../explain";
import { buildDrillContext } from "../context";
import { taxAdapter } from "../subjects/tax";
import { DRILL_CTX, makeLedger, makeTaxDetail, makeTaxResult, makeYear } from "./fixtures";
import type { AccountLedger, ClientData, ProjectionYear } from "@/engine/types";
import type { DrillContext } from "../types";

const base = (year: number, totalTax: number) =>
  makeYear({ year, taxResult: makeTaxResult({ flow: { totalTax, totalFederalTax: totalTax, taxableIncome: totalTax * 4 } }) });

// ── Reversal cross-check fixture (Task 6) ────────────────────────────────────
// Draws sit in a tax-free Roth IRA in 2060–2061, jump to a pre-tax IRA in 2062
// (the cliff — blended recognition 0 → 1.0, tax spikes 22k → 45k), then swing
// back to the Roth IRA in 2063 (the mirror — ratio 1.0 → 0, tax falls 45k → 20k).
function reversalCtx(): DrillContext {
  return {
    ...DRILL_CTX,
    accountNames: { rira: "Client Roth IRA", tira: "Client IRA" },
    accounts: [
      { id: "rira", name: "Client Roth IRA", category: "retirement", subType: "roth_ira" },
      { id: "tira", name: "Client IRA", category: "retirement", subType: "traditional_ira" },
    ] as unknown as DrillContext["accounts"],
  };
}

const rothDrawYear = (
  year: number,
  totalTax: number,
  taxableIncome: number,
  rira: Partial<AccountLedger>,
  tira: Partial<AccountLedger>,
): ProjectionYear =>
  makeYear({
    year,
    withdrawals: { byAccount: { rira: 100_000 }, total: 100_000 },
    accountLedgers: { rira: makeLedger(rira), tira: makeLedger(tira) },
    taxDetail: makeTaxDetail({}),
    taxResult: makeTaxResult({ flow: { totalTax, totalFederalTax: totalTax, taxableIncome } }),
  });

const preTaxDrawYear = (
  year: number,
  totalTax: number,
  taxableIncome: number,
  rira: Partial<AccountLedger>,
  tira: Partial<AccountLedger>,
): ProjectionYear =>
  makeYear({
    year,
    withdrawals: { byAccount: { tira: 120_000 }, total: 120_000 },
    accountLedgers: { rira: makeLedger(rira), tira: makeLedger(tira) },
    taxDetail: makeTaxDetail({ "withdrawal:tira": { type: "ordinary", amount: 120_000 } }),
    taxResult: makeTaxResult({ flow: { totalTax, totalFederalTax: totalTax, taxableIncome } }),
  });

function reversalFixtureYears(): ProjectionYear[] {
  return [
    rothDrawYear(2060, 20_000, 80_000, { beginningValue: 600_000, endingValue: 500_000 }, { beginningValue: 600_000, endingValue: 600_000 }),
    rothDrawYear(2061, 22_000, 90_000, { beginningValue: 500_000, endingValue: 400_000 }, { beginningValue: 600_000, endingValue: 600_000 }),
    preTaxDrawYear(2062, 45_000, 250_000, { beginningValue: 400_000, endingValue: 400_000 }, { beginningValue: 600_000, endingValue: 480_000 }),
    rothDrawYear(2063, 20_000, 80_000, { beginningValue: 400_000, endingValue: 300_000 }, { beginningValue: 480_000, endingValue: 480_000 }),
  ];
}

describe("explainChange", () => {
  it("rejects years outside the projection range with the available range", () => {
    const out = explainChange({
      adapter: taxAdapter,
      years: [base(2060, 10_000), base(2061, 11_000)],
      firstDeathYear: null, secondDeathYear: null, year: 2099, ctx: DRILL_CTX,
    });
    expect(out.available).toBe(false);
    if (!out.available) {
      expect(out.availableYears).toEqual({ first: 2060, last: 2061 });
      expect(out.reason).toContain("2099");
    }
  });

  it("defaults compareYear to year − 1", () => {
    const out = explainChange({
      adapter: taxAdapter,
      years: [base(2062, 55_800), base(2063, 142_000)],
      firstDeathYear: null, secondDeathYear: null, year: 2063, ctx: DRILL_CTX,
    });
    expect(out.available).toBe(true);
    if (out.available) {
      expect(out.compareYear).toBe(2062);
      expect(out.headline.figure.delta).toBe(86_200);
    }
  });

  it("degrades gracefully when a year lacks taxResult", () => {
    const noTax = makeYear({ year: 2062, taxResult: undefined, expenses: { ...makeYear({ year: 2062 }).expenses, taxes: 50_000 } });
    const out = explainChange({
      adapter: taxAdapter,
      years: [noTax, base(2063, 142_000)],
      firstDeathYear: null, secondDeathYear: null, year: 2063, ctx: DRILL_CTX,
    });
    expect(out.available).toBe(true);
    if (out.available) {
      expect(out.degraded).toBe(true);
      expect(out.causes).toBeUndefined();
      expect(out.notes.join(" ")).toContain("expenses.taxes");
    }
  });

  it("flags an immaterial change but still returns the waterfall", () => {
    const out = explainChange({
      adapter: taxAdapter,
      years: [base(2062, 50_000), base(2063, 50_200)],
      firstDeathYear: null, secondDeathYear: null, year: 2063, ctx: DRILL_CTX,
    });
    if (out.available) {
      expect(out.noSignificantChange).toBe(true);
      expect(out.headline.figure.delta).toBe(200);
    }
  });

  it("end-to-end: depletion-shift fixture yields funding_character_shift as the top cause with an estimate", () => {
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { brok: 120_000 }, total: 120_000 },
      accountLedgers: { brok: makeLedger({ beginningValue: 118_000, endingValue: 0 }) },
      taxDetail: makeTaxDetail({ "withdrawal:brok": { type: "capGains", amount: 20_000 } }),
      taxResult: makeTaxResult({ flow: { totalTax: 55_800, totalFederalTax: 50_000, stateTax: 5_800, taxableIncome: 150_000 } }),
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { ira: 190_000 }, total: 190_000 },
      accountLedgers: { ira: makeLedger({ beginningValue: 900_000, endingValue: 750_000 }) },
      taxDetail: makeTaxDetail({ "withdrawal:ira": { type: "ordinary", amount: 190_000 } }),
      taxResult: makeTaxResult({ flow: { totalTax: 142_000, totalFederalTax: 130_000, stateTax: 12_000, taxableIncome: 400_000 } }),
    });
    const out = explainChange({ adapter: taxAdapter, years: [prev, next], firstDeathYear: null, secondDeathYear: null, year: 2063, ctx: DRILL_CTX });
    expect(out.available).toBe(true);
    if (out.available) {
      expect(out.causes?.[0]?.kind).toBe("funding_character_shift");
      // funding recognition ratio 17% → 100% ⇒ implied ordinary income ≈ $158,333;
      // estimate = 158,333 × blendedRate(86,200 / 250,000 = 0.3448) ≈ 54,593
      expect(out.causes?.[0]?.estimatedImpact).toBe(Math.round(158_333 * (86_200 / 250_000)));
      expect(out.notes.some((n) => n.includes("approximation"))).toBe(true);
    }
  });

  it("keeps filing-status narration honest when its residual estimate goes negative", () => {
    // Death year triggers filing_status_change. taxableIncome FALLS year over
    // year (taxableDelta <= 0), so blendedRate falls back to next year's flat
    // marginalFederalRate (0.35) rather than the actual (small) tax/taxable
    // ratio. Applying that rate to a large realized-gain incomeDelta overshoots
    // the real total-tax delta, driving the filing_status_change residual
    // (totalDelta − attributed) deeply negative — while a death year with a
    // materially higher marginal rate would otherwise read as "taxed harder".
    const prev = makeYear({
      year: 2062,
      taxResult: makeTaxResult({
        flow: { totalTax: 200_000, totalFederalTax: 180_000, stateTax: 20_000, taxableIncome: 700_000 },
        marginalFederalRate: 0.24,
      }),
    });
    const next = makeYear({
      year: 2063,
      taxDetail: makeTaxDetail({ "sale:tx1": { type: "capGains", amount: 800_000 } }),
      taxResult: makeTaxResult({
        flow: { totalTax: 220_000, totalFederalTax: 195_000, stateTax: 25_000, taxableIncome: 690_000 },
        marginalFederalRate: 0.35,
      }),
    });
    const out = explainChange({
      adapter: taxAdapter,
      years: [prev, next],
      firstDeathYear: 2063, secondDeathYear: null, year: 2063, ctx: DRILL_CTX,
    });
    expect(out.available).toBe(true);
    if (!out.available) return;
    const fsCause = out.causes?.find((c) => c.kind === "filing_status_change");
    expect(fsCause).toBeDefined();
    expect(fsCause!.estimatedImpact).toBeLessThan(0);
    expect(JSON.stringify(out.causes)).not.toContain("taxed harder");
    expect(out.notes.some((n) => n.toLowerCase().includes("residual"))).toBe(true);
  });

  it("adds the IRMAA 2-year-lookback note when N+2 surcharge rises", () => {
    const y64 = makeYear({ year: 2064, medicare: { totalAnnualCost: 8_000, totalIrmaaSurcharge: 0 } });
    const y65 = makeYear({ year: 2065, medicare: { totalAnnualCost: 12_000, totalIrmaaSurcharge: 3_400 } });
    const out = explainChange({
      adapter: taxAdapter,
      years: [base(2062, 55_800), base(2063, 142_000), y64, y65],
      firstDeathYear: null, secondDeathYear: null, year: 2063, ctx: DRILL_CTX,
    });
    if (out.available) {
      expect(out.notes.some((n) => n.includes("IRMAA") && n.includes("2065"))).toBe(true);
    }
  });

  it("cites the reversal boundary as confirmation when a mirror exists", () => {
    const res = explainChange({
      adapter: taxAdapter,
      years: reversalFixtureYears(),
      firstDeathYear: null, secondDeathYear: null, year: 2062, ctx: reversalCtx(),
    });
    expect(res.available).toBe(true);
    if (!res.available) return;
    expect(res.causes?.[0]?.kind).toBe("funding_character_shift");
    expect(res.notes.some((n) => /reversal|confirmed by/i.test(n))).toBe(true);
    // Names the 2062–2063 boundary and the tax it falls to.
    expect(res.notes.some((n) => n.includes("2062–2063") && n.includes("$20,000"))).toBe(true);
  });

  it("stays silent when a tax fall isn't a funding-character reversal", () => {
    // Same cliff, but 2063 keeps drawing from the pre-tax IRA (blended ratio holds
    // at ~1.0) while a deduction jump drops the tax — a fall, not a reversal of the
    // mechanism. The falling boundary IS selected, but its ratio never swings back.
    const years = reversalFixtureYears();
    years[3] = preTaxDrawYear(
      2063, 25_000, 120_000,
      { beginningValue: 400_000, endingValue: 400_000 },
      { beginningValue: 480_000, endingValue: 360_000 },
    );
    const res = explainChange({
      adapter: taxAdapter,
      years,
      firstDeathYear: null, secondDeathYear: null, year: 2062, ctx: reversalCtx(),
    });
    expect(res.available).toBe(true);
    if (!res.available) return;
    expect(res.causes?.[0]?.kind).toBe("funding_character_shift");
    expect(res.notes.some((n) => /reversal|confirmed by/i.test(n))).toBe(false);
  });
});

describe("buildDrillContext", () => {
  it("maps account, entity, roth-conversion, and note names from the tree", () => {
    const tree = {
      accounts: [{ id: "a1", name: "Brokerage" }],
      incomes: [],
      entities: [{ id: "e1", name: "Family Trust" }],
      rothConversions: [{ id: "rc1", name: "Bracket fill" }],
      notesReceivable: [{ id: "n1", name: "Seller note" }],
    } as unknown as ClientData;
    const ctx = buildDrillContext(tree, [makeYear({ year: 2062, syntheticAccounts: [{ id: "s1", name: "Vested RSUs", category: "taxable", owners: [] }] })]);
    expect(ctx.accountNames).toMatchObject({ a1: "Brokerage", s1: "Vested RSUs" });
    expect(ctx.entityNames).toMatchObject({ e1: "Family Trust" });
    expect(ctx.rothConversionNames).toMatchObject({ rc1: "Bracket fill" });
    expect(ctx.noteNames).toMatchObject({ n1: "Seller note" });
  });
});
