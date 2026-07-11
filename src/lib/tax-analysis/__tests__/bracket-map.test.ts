import { describe, it, expect } from "vitest";
import { buildBracketMap, computeBracketBarLayout } from "../bracket-map";
import { params2025, retireeMfj } from "./fixtures";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

describe("buildBracketMap", () => {
  it("returns null without taxable income or filing status", () => {
    expect(buildBracketMap(emptyTaxReturnFacts(2025), params2025)).toBeNull();
  });

  it("positions the retiree in the 22% bracket with correct headroom", () => {
    const map = buildBracketMap(retireeMfj(), params2025)!;
    // ordinary base = TI 155500 − (LTCG 20000 + qualDiv 15000) = 120500
    expect(map.ordinary.taxBase).toBe(120500);
    expect(map.ordinary.marginalRate).toBe(0.22);
    expect(map.ordinary.headroomToNext).toBe(206700 - 120500);
    expect(map.ordinary.nextRate).toBe(0.24);
    // fill amounts per segment sum to the tax base
    const filled = map.ordinary.segments.reduce((s, seg) => s + seg.filled, 0);
    expect(filled).toBe(120500);
  });

  it("computes cap-gains stacking and 0% headroom", () => {
    const map = buildBracketMap(retireeMfj(), params2025)!;
    expect(map.capGains.preferentialBase).toBe(35000);
    expect(map.capGains.ordinaryFloor).toBe(120500);
    // total TI 155500 already above zeroPctTop 96700 → no 0% room
    expect(map.capGains.zeroPctHeadroom).toBe(0);
  });

  it("reports 0% headroom for a low-income filer", () => {
    const f = retireeMfj();
    f.deductions.taxableIncome = 60000;
    f.income.netLongTermGain = 10000;
    f.income.qualifiedDividends = 0;
    const map = buildBracketMap(f, params2025)!;
    // ordinary floor 50000, pref 10000 → top of stack 60000; room to 96700
    expect(map.capGains.zeroPctHeadroom).toBe(96700 - 60000);
  });

  it("caps the cap-gains stack at taxable income when deductions eat the ordinary portion", () => {
    // Ordinary $10k + LTCG $50k − MFJ std deduction $30k → TI 30000 < preferential 50000.
    // Per the QDCGT worksheet the stacked amount can never exceed TI: stack top is
    // 30000, not taxBase(0) + pref(50000) = 50000.
    const f = retireeMfj();
    f.deductions.taxableIncome = 30000;
    f.income.netLongTermGain = 50000;
    f.income.netShortTermGain = 0;
    f.income.qualifiedDividends = 0;
    const map = buildBracketMap(f, params2025)!;
    expect(map.ordinary.taxBase).toBe(0);
    expect(map.capGains.preferentialBase).toBe(50000);
    expect(map.capGains.zeroPctHeadroom).toBe(96700 - 30000);
  });

  it("clamps a filed capital loss to zero preferential income", () => {
    const f = retireeMfj();
    f.income.netLongTermGain = -3000;
    f.income.netShortTermGain = 0;
    f.income.capitalGainOrLoss = -3000;
    const map = buildBracketMap(f, params2025)!;
    // loss clamps to 0 → preferential is qualified dividends only
    expect(map.capGains.preferentialBase).toBe(15000);
    expect(map.ordinary.taxBase).toBe(155500 - 15000);
  });

  it("treats short-term-only Schedule D as zero LTCG (no line-7 fallback)", () => {
    const f = retireeMfj();
    f.income.netLongTermGain = null;
    f.income.netShortTermGain = 20000;
    f.income.capitalGainOrLoss = 20000;
    const map = buildBracketMap(f, params2025)!;
    // Schedule D detail present (short-term line) → LTCG is 0, NOT line 7's 20000
    expect(map.capGains.preferentialBase).toBe(15000);
    expect(map.ordinary.taxBase).toBe(155500 - 15000);
  });
});

describe("computeBracketBarLayout", () => {
  it("produces finite, non-NaN widths for the retiree persona", () => {
    const map = buildBracketMap(retireeMfj(), params2025)!;
    const layout = computeBracketBarLayout(map);
    expect(layout.segments.length).toBeGreaterThan(0);
    for (const seg of layout.segments) {
      expect(Number.isFinite(seg.widthPct)).toBe(true);
      expect(Number.isFinite(seg.fillPct)).toBe(true);
    }
    expect(Number.isFinite(layout.capGains.floorPct)).toBe(true);
    expect(Number.isFinite(layout.capGains.markerLeftPct)).toBe(true);
  });

  it("guards against NaN when ordinary taxBase is 0 (scaleTop floor of 1)", () => {
    // Same recipe as the bracket-map-bars/PDF NaN-regression fixtures:
    // deductions eat the ordinary portion entirely.
    const f = retireeMfj();
    f.deductions.taxableIncome = 30000;
    f.income.netLongTermGain = 50000;
    f.income.netShortTermGain = 0;
    f.income.qualifiedDividends = 0;
    const map = buildBracketMap(f, params2025)!;
    expect(map.ordinary.taxBase).toBe(0);
    const layout = computeBracketBarLayout(map);
    for (const seg of layout.segments) {
      expect(Number.isFinite(seg.widthPct)).toBe(true);
      expect(Number.isFinite(seg.fillPct)).toBe(true);
    }
  });
});
