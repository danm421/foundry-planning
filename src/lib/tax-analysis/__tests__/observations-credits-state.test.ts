import { describe, it, expect } from "vitest";
import { ctcPhaseout, educationCredits, stateNotes } from "../observations/credits-state";
import type { ObservationContext } from "../types";
import { params2025, retireeMfj, highEarnerMfj } from "./fixtures";

function ctxFor(facts: ReturnType<typeof retireeMfj>): ObservationContext {
  return { facts, prior: null, params: params2025, irmaaParams: params2025, primaryAge: 45, spouseAge: 44 };
}

describe("ctcPhaseout", () => {
  it("computes the reduction for AGI over the MFJ threshold", () => {
    const o = ctcPhaseout(ctxFor(highEarnerMfj()))!; // agi 467000, over by 67000
    expect(o.severity).toBe("watch");
    expect(o.numbers.excess).toBe(67000);
  });
  it("skips without qualifying children", () => {
    expect(ctcPhaseout(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("educationCredits", () => {
  it("notes MAGI above the AOTC window for a high earner with college-age kids", () => {
    const f = highEarnerMfj();
    f.dependents17to23 = 1;
    const o = educationCredits(ctxFor(f))!;
    expect(o.body).toContain("education credit");
  });
  it("skips without college-age dependents or claimed credits", () => {
    expect(educationCredits(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("stateNotes", () => {
  it("reports a no-income-tax state", () => {
    const f = retireeMfj();
    f.residenceState = "FL";
    const o = stateNotes(ctxFor(f))!;
    expect(o.body).toContain("no state income tax");
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
