import { describe, it, expect } from "vitest";
import { irmaaCliff, qcd } from "../findings/retirement";
import { formatLineRefs } from "../findings/line-refs";
import { retireeMfj, findingCtx } from "./fixtures";

describe("irmaaCliff", () => {
  it("prices a tier-1-or-higher surcharge per covered person", () => {
    const facts = retireeMfj();
    facts.income.agi = 280000; // MAGI 292,000 with 12,000 tax-exempt → MFJ tier 2
    const f = irmaaCliff(findingCtx(facts, { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.severity).toBe("watch");
    expect(f.category).toBe("retirement");
    expect(f.numbers.tier).toBe(2);
    // partB 2220 + partD 415 — the per-person surcharge, which is what the
    // household actually pays twice over.
    expect(f.estimatedImpact).toBe(2635);
    expect(f.whyItMatters).toContain("per covered person");
    expect(f.whatToConsider).not.toBe("");
  });

  it("carries NO impact figure when the return is merely near the first cliff", () => {
    const f = irmaaCliff(findingCtx(retireeMfj(), { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.numbers.tier).toBe(0);
    expect(f.numbers.distanceToNextCliff).toBe(11300);
    expect(f.estimatedImpact).toBeNull(); // nothing has been incurred yet
  });
});

describe("qcd", () => {
  it("prices the deduction the cash gift failed to buy when the return takes the standard deduction", () => {
    const facts = retireeMfj();
    facts.deductions.scheduleA = {
      saltPaid: 0, saltDeducted: 0, mortgageInterest: 0,
      charitableCash: 12000, charitableNonCash: 0, medical: 0,
    };
    const f = qcd(findingCtx(facts, { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.category).toBe("retirement");
    expect(f.numbers.charitableCash).toBe(12000);
    expect(f.estimatedImpact).toBeCloseTo(12000 * f.numbers.marginalRate, 6);
    expect(formatLineRefs(f.lineRefs)).toBe("Form 1040 line 4a · Schedule A line 11");
  });

  it("phrases the opportunity conditionally and carries no figure when no gift is on the return", () => {
    const f = qcd(findingCtx(retireeMfj(), { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.numbers.charitableCash).toBe(0);
    expect(f.estimatedImpact).toBeNull();
    expect(f.whatTheReturnShows).toContain("If charitable giving");
    expect(formatLineRefs(f.lineRefs)).toBe("Form 1040 line 4a");
  });
});
