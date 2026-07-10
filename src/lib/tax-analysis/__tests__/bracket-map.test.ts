import { describe, it, expect } from "vitest";
import { buildBracketMap } from "../bracket-map";
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
});
