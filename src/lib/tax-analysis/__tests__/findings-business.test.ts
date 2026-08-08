import { describe, it, expect } from "vitest";
import { qbiPhaseoutPosition, sCorpElection, seHealthInsurance } from "../findings/business";
import { formatLineRefs } from "../findings/line-refs";
import { findingCtx, scheduleCOwnerSingle, sCorpOwnerMfj, retireeMfj } from "./fixtures";

describe("qbiPhaseoutPosition", () => {
  it("names the W-2 wage cap as the binding limit and prices what it costs", () => {
    const f = qbiPhaseoutPosition(findingCtx(sCorpOwnerMfj(), { primaryAge: 51, spouseAge: 49 }))!;
    expect(f.category).toBe("business");
    expect(f.severity).toBe("opportunity");
    expect(f.numbers.qualifiedBusinessIncome).toBe(352000);
    expect(f.numbers.fullTwentyPercent).toBe(70400);
    expect(f.numbers.qbiDeduction).toBe(60000);
    expect(f.numbers.shortfall).toBe(10400);
    // ti (437,761) + taken (60,000) — business.ts:40's pre-QBI add-back, not
    // the post-QBI taxableIncome on line 15.
    expect(f.numbers.taxableIncomeBeforeQbi).toBe(497761);
    // params.qbi.thresholdMfj — pins the MFJ arm of qbiThresholdFor.
    expect(f.numbers.threshold).toBe(394600);
    // ctx.calc.diag.marginalFederalRate wins over ctx.bracketMap.ordinary.marginalRate
    // (0.32) in marginalRateFor's precedence.
    expect(f.numbers.marginalRate).toBe(0.37);
    expect(f.estimatedImpact).toBeCloseTo(3848, 6); // 10,400 shortfall × 0.37
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

  it("switches to the info severity once the full 20% survives past the threshold", () => {
    const facts = sCorpOwnerMfj();
    facts.deductions.qbiDeduction = 70400; // full 20% of 352,000 QBI — shortfall === 0
    const f = qbiPhaseoutPosition(findingCtx(facts, { primaryAge: 51, spouseAge: 49 }))!;
    expect(f).not.toBeNull();
    expect(f.severity).toBe("info");
    expect(f.numbers.shortfall).toBe(0);
    // 437,761 + 70,400 = 508,161 still clears the 394,600 threshold, so the
    // finding fires — this is the "above threshold but unrestricted" arm, not
    // the below-threshold null branch covered above.
    expect(f.numbers.taxableIncomeBeforeQbi).toBe(508161);
    expect(f.whyItMatters).toContain("Here the limit is not yet binding");
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

  it("stays silent below the SE_MIN_EARNINGS floor even with real Schedule C detail present", () => {
    const facts = scheduleCOwnerSingle();
    facts.businesses[0].netProfit = 5000;
    facts.income.scheduleCNet = 5000; // selfEmploymentEarnings === 5,000 < 10,000 floor
    expect(seHealthInsurance(findingCtx(facts, { primaryAge: 44 }))).toBeNull();
  });
});
