import { describe, it, expect } from "vitest";
import { ctcPhaseout, educationCredits, stateNotes } from "../findings/credits-state";
import { retireeMfj, highEarnerMfj, landlordSingle, findingCtx } from "./fixtures";

const ctxFor = (facts: ReturnType<typeof retireeMfj>) =>
  findingCtx(facts, { primaryAge: 45, spouseAge: 44 });

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
