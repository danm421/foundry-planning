import { describe, it, expect } from "vitest";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { ctcPhaseout, educationCredits, stateNotes } from "../findings/credits-state";
import { retireeMfj, highEarnerMfj, landlordSingle, findingCtx } from "./fixtures";

const ctxFor = (facts: ReturnType<typeof retireeMfj>) =>
  findingCtx(facts, { primaryAge: 45, spouseAge: 44 });

const mutate = (base: TaxReturnFacts, f: (x: TaxReturnFacts) => void): TaxReturnFacts => {
  f(base);
  return base;
};

describe("ctcPhaseout", () => {
  it("flags the CTC phase-out with the $50-per-$1,000 reduction", () => {
    const f = ctcPhaseout(findingCtx(highEarnerMfj(), { primaryAge: 45, spouseAge: 45 }))!;
    expect(f.category).toBe("credits");
    expect(f.numbers.reduction).toBe(3350); // ceil(67000/1000) × 50
    expect(f.estimatedImpact).toBe(3350);
    expect(f.whatTheReturnShows).toContain("$467,000");
  });
  it("skips without qualifying children", () => {
    expect(ctcPhaseout(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("ctcPhaseout — RULING 1: capped at the credit that exists", () => {
  // params2025 (fixtures.ts, off limits) seeds ctc.perChild as null, so each
  // test here builds its own params override. PER_CHILD is a synthetic
  // test-local figure — deliberately NOT $2,000 or $2,200 (the real IRS
  // amounts) — chosen only to exercise the cap; every assertion below reads
  // it back out of this same variable rather than a separate literal.
  const PER_CHILD = 3000;
  const withPerChild = (facts: TaxReturnFacts, perChild: number | null) => {
    const ctx = findingCtx(facts, { primaryAge: 45, spouseAge: 45 });
    return { ...ctx, params: { ...ctx.params, ctc: { ...ctx.params.ctc, perChild } } };
  };

  it("caps estimatedImpact at kids * perChild when the raw rate-based figure would exceed it", () => {
    const facts = mutate(highEarnerMfj(), (f) => {
      f.dependentsUnder17 = 1;
      f.income.agi = 500000;
    });
    const f = ctcPhaseout(withPerChild(facts, PER_CHILD))!;
    const kids = facts.dependentsUnder17 as number;
    expect(f.estimatedImpact).toBe(kids * PER_CHILD);
    expect(f.numbers.reduction).toBe(kids * PER_CHILD);
    expect(f.estimatedImpact).not.toBe(5000); // the uncapped rate-based figure (ceil(100000/1000)*50)
    expect(f.whatTheReturnShows).toContain("removes the entire");
  });

  it("keeps the raw rate-based figure when it sits under the ceiling", () => {
    const f = ctcPhaseout(withPerChild(highEarnerMfj(), PER_CHILD))!;
    expect(f.numbers.reduction).toBe(3350); // unchanged from the uncapped baseline test above
    expect(f.estimatedImpact).toBe(3350);
    expect(f.whatTheReturnShows).toContain("cutting roughly");
    expect(f.whatTheReturnShows).not.toContain("removes the entire");
  });

  it("degrades to the uncapped figure when perChild is unseeded (null)", () => {
    const ctx = withPerChild(highEarnerMfj(), null);
    expect(() => ctcPhaseout(ctx)).not.toThrow();
    const f = ctcPhaseout(ctx)!;
    expect(f.numbers.reduction).toBe(3350);
    expect(f.estimatedImpact).toBe(3350);
  });
});

describe("educationCredits", () => {
  it("never prices the education credit — the lost fraction is not on the return", () => {
    const facts = highEarnerMfj();
    facts.dependents17to23 = 1;
    const f = educationCredits(findingCtx(facts, { primaryAge: 45, spouseAge: 45 }))!;
    expect(f.estimatedImpact).toBeNull();
    expect(f.whatToConsider).toContain("529");
  });
  it("skips without college-age dependents or claimed credits", () => {
    expect(educationCredits(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("stateNotes", () => {
  it("states the no-income-tax case with four parts and no line refs", () => {
    const facts = landlordSingle();
    facts.residenceState = "TX";
    const f = stateNotes(findingCtx(facts, { primaryAge: 41 }))!;
    expect(f.category).toBe("state");
    expect(f.headline).toContain("TX");
    expect(f.whyItMatters).not.toBe("");
    expect(f.lineRefs).toEqual([]); // nothing on the FEDERAL return says this
  });
  it("estimates state tax for PA via the state engine", () => {
    const o = stateNotes(ctxFor(retireeMfj()))!;
    expect(o.numbers.stateTax).toBeGreaterThanOrEqual(0);
    expect(o.id).toBe("state-notes");
  });
  it("skips when the state is unknown", () => {
    const f = retireeMfj();
    f.residenceState = null;
    expect(stateNotes(ctxFor(f))).toBeNull();
  });
});
