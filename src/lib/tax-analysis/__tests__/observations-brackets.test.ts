import { describe, it, expect } from "vitest";
import { bracketPosition, rothHeadroom, ltcgZeroHeadroom } from "../observations/brackets";
import type { ObservationContext } from "../types";
import { params2025, retireeMfj } from "./fixtures";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

function ctxFor(facts = retireeMfj()): ObservationContext {
  return { facts, prior: null, params: params2025, irmaaParams: params2025, primaryAge: 72, spouseAge: 72 };
}

describe("bracketPosition", () => {
  it("reports the 22% bracket with headroom", () => {
    const o = bracketPosition(ctxFor())!;
    expect(o.id).toBe("bracket-position");
    expect(o.severity).toBe("info");
    expect(o.numbers.marginalRate).toBe(0.22);
    expect(o.numbers.headroom).toBe(86200);
    expect(o.body).toContain("22%");
  });
  it("skips when taxable income is missing", () => {
    expect(bracketPosition(ctxFor(emptyTaxReturnFacts(2025)))).toBeNull();
  });
});

describe("rothHeadroom", () => {
  it("quantifies conversion room within the current bracket", () => {
    const o = rothHeadroom(ctxFor())!;
    expect(o.severity).toBe("opportunity");
    expect(o.numbers.headroom).toBe(86200);
    expect(o.body).toContain("$86,200");
  });
  it("adds an IRMAA caveat when a cliff sits inside the headroom", () => {
    // retiree MAGI = 188700 + 12000 = 200700; MFJ tier-1 bound 212000 is
    // 11300 away — inside the 86200 of bracket headroom.
    const o = rothHeadroom(ctxFor())!;
    expect(o.body).toContain("IRMAA");
    expect(o.numbers.irmaaCliffDistance).toBe(11300);
  });
});

describe("ltcgZeroHeadroom", () => {
  it("skips when the 0% bracket is already exceeded", () => {
    expect(ltcgZeroHeadroom(ctxFor())).toBeNull();
  });
  it("reports harvestable gains for a low-income filer", () => {
    const f = retireeMfj();
    f.deductions.taxableIncome = 60000;
    f.income.netLongTermGain = 10000;
    f.income.qualifiedDividends = 0;
    const o = ltcgZeroHeadroom(ctxFor(f))!;
    expect(o.numbers.headroom).toBe(36700);
    expect(o.severity).toBe("opportunity");
  });
});
