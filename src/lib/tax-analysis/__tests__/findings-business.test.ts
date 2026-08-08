import { describe, it, expect } from "vitest";
import { qbiPhaseoutPosition, sCorpElection, seHealthInsurance } from "../findings/business";
import { formatLineRefs } from "../findings/line-refs";
import { findingCtx, scheduleCOwnerSingle, sCorpOwnerMfj, retireeMfj } from "./fixtures";

describe("qbiPhaseoutPosition", () => {
  it("names the W-2 wage cap as the binding limit and prices what it costs", () => {
    const f = qbiPhaseoutPosition(findingCtx(sCorpOwnerMfj(), { primaryAge: 51, spouseAge: 49 }))!;
    expect(f.category).toBe("business");
    expect(f.numbers.qualifiedBusinessIncome).toBe(352000);
    expect(f.numbers.fullTwentyPercent).toBe(70400);
    expect(f.numbers.qbiDeduction).toBe(60000);
    expect(f.numbers.shortfall).toBe(10400);
    expect(f.estimatedImpact).toBeCloseTo(10400 * f.numbers.marginalRate, 6);
    expect(f.whyItMatters).toContain("W-2 wages");
  });

  it("stays silent below the threshold — the phase-out has not started", () => {
    // 134,756 − 15,750 = 119,006 of taxable income before QBI, under 197,300.
    expect(qbiPhaseoutPosition(findingCtx(scheduleCOwnerSingle(), { primaryAge: 44 }))).toBeNull();
  });

  it("stays silent when Form 8995 detail was never extracted", () => {
    const facts = sCorpOwnerMfj();
    facts.deductions.qbi = null;
    expect(qbiPhaseoutPosition(findingCtx(facts, { primaryAge: 51, spouseAge: 49 }))).toBeNull();
  });
});

describe("sCorpElection", () => {
  it("prices the FULL SE tax as an honest ceiling and says so in the prose", () => {
    const f = sCorpElection(findingCtx(scheduleCOwnerSingle(), { primaryAge: 44 }))!;
    expect(f.category).toBe("business");
    expect(f.numbers.scheduleCProfit).toBe(145000);
    expect(f.estimatedImpact).toBeCloseTo(20487.85, 2); // the whole Schedule SE tax
    expect(f.whyItMatters).toContain("reduces");
    expect(f.whyItMatters).toContain("never eliminates");
    expect(formatLineRefs(f.lineRefs)).toBe("Schedule 1 line 3 · Schedule 2 line 4 · Schedule 1 line 15");
  });

  it("stays silent below the profit floor where a second entity cannot pay for itself", () => {
    const facts = scheduleCOwnerSingle();
    facts.businesses[0].netProfit = 24000;
    facts.income.scheduleCNet = 24000;
    expect(sCorpElection(findingCtx(facts, { primaryAge: 44 }))).toBeNull();
  });

  it("stays silent for a return with no Schedule C at all", () => {
    expect(sCorpElection(findingCtx(sCorpOwnerMfj(), { primaryAge: 51, spouseAge: 49 }))).toBeNull();
  });
});

describe("seHealthInsurance", () => {
  it("flags an empty line 17 against real SE income, with no invented figure", () => {
    const f = seHealthInsurance(findingCtx(scheduleCOwnerSingle(), { primaryAge: 44 }))!;
    expect(f.severity).toBe("opportunity");
    expect(f.category).toBe("business");
    expect(f.estimatedImpact).toBeNull(); // the return does not state the premium
    expect(f.whatTheReturnShows).toContain("line 17");
  });

  it("stays silent when line 17 already carries a deduction", () => {
    const facts = scheduleCOwnerSingle();
    facts.income.adjustmentsDetail!.selfEmployedHealthInsurance = 9800;
    expect(seHealthInsurance(findingCtx(facts, { primaryAge: 44 }))).toBeNull();
  });

  it("stays silent when there is no self-employment income", () => {
    expect(seHealthInsurance(findingCtx(retireeMfj(), { primaryAge: 72, spouseAge: 72 }))).toBeNull();
  });
});
