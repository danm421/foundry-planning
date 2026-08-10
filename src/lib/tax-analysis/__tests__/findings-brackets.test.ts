import { describe, it, expect } from "vitest";
import { bracketPosition, rothHeadroom, ltcgZeroHeadroom } from "../findings/brackets";
import { formatLineRefs } from "../findings/line-refs";
import { retireeMfj, findingCtx } from "./fixtures";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

const ctxFor = (facts = retireeMfj()) => findingCtx(facts, { primaryAge: 72, spouseAge: 72 });

describe("bracketPosition", () => {
  it("reports the 22% bracket with headroom, in four parts", () => {
    const f = bracketPosition(ctxFor())!;
    expect(f.id).toBe("bracket-position");
    expect(f.severity).toBe("info");
    expect(f.category).toBe("brackets");
    expect(f.numbers.marginalRate).toBe(0.22);
    expect(f.numbers.headroom).toBe(86200);
    expect(f.whatTheReturnShows).toContain("22%");
    expect(f.whyItMatters).toContain("$86,200");
    expect(f.whatToConsider).not.toBe("");
    expect(f.estimatedImpact).toBeNull(); // positional, not a dollar claim
    expect(formatLineRefs(f.lineRefs)).toBe("Form 1040 line 15 · line 3a");
  });
  it("skips when taxable income is missing", () => {
    expect(bracketPosition(ctxFor(emptyTaxReturnFacts(2025)))).toBeNull();
  });
});

describe("rothHeadroom", () => {
  it("quantifies conversion room and prices the rate differential", () => {
    const f = rothHeadroom(ctxFor())!;
    expect(f.severity).toBe("opportunity");
    expect(f.category).toBe("retirement");
    expect(f.numbers.headroom).toBe(86200);
    expect(f.numbers.rateDifferential).toBeCloseTo(0.02, 10); // 24% − 22%
    // 86,200 × 2 points. The prose SAYS this is the extra cost of converting
    // the same dollars a bracket higher — not a saving versus not converting.
    expect(f.estimatedImpact).toBeCloseTo(1724, 6);
    expect(f.whatTheReturnShows).toContain("$86,200");
  });
  it("adds an IRMAA caveat when a cliff sits inside the headroom", () => {
    const f = rothHeadroom(ctxFor())!;
    expect(f.whyItMatters).toContain("IRMAA");
    expect(f.numbers.irmaaCliffDistance).toBe(11300);
  });
});

describe("ltcgZeroHeadroom", () => {
  it("skips when the 0% bracket is already exceeded", () => {
    expect(ltcgZeroHeadroom(ctxFor())).toBeNull();
  });
  it("reports harvestable gains and prices them at the 15% rate they escape", () => {
    const facts = retireeMfj();
    facts.deductions.taxableIncome = 60000;
    facts.income.netLongTermGain = 10000;
    facts.income.qualifiedDividends = 0;
    const f = ltcgZeroHeadroom(ctxFor(facts))!;
    expect(f.numbers.headroom).toBe(36700);
    expect(f.category).toBe("investments");
    expect(f.estimatedImpact).toBeCloseTo(5505, 6); // 36,700 × 15%
    expect(f.whatToConsider).toContain("31 December");
  });
});
