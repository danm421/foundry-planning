import { describe, it, expect } from "vitest";
import { resolveStatusLabel } from "../solver-thresholds-panel";
import {
  THRESHOLD_ITEMS,
  rangeFor,
  isNaRange,
  type ThresholdHousehold,
} from "@/lib/tax/thresholds";
import type { TaxYearParameters } from "@/lib/tax/types";

// Same fixture shape as src/lib/reports/__tests__/threshold-report-data.test.ts
// — fully seeded so every item resolves a REAL range (not the NA sentinel)
// wherever one exists structurally, letting the guard test below tell
// "genuinely a point threshold" apart from "NA because unseeded/inapplicable".
const params = {
  rothPhaseout: { startMfj: 242000, endMfj: 252000, startSingle: 153000, endSingle: 168000 },
  iraDeduct: {
    coveredStartMfj: 129000, coveredEndMfj: 149000,
    coveredStartSingle: 81000, coveredEndSingle: 91000,
    spousalStartMfj: 242000, spousalEndMfj: 252000,
  },
  studentLoan: { maxDeduction: 2500, startMfj: 175000, endMfj: 205000, startSingle: 85000, endSingle: 100000 },
  ctc: { perChild: 2200, refundableMax: 1700, odcPerDependent: 500 },
  saversCredit: { mfj: [{ rate: 0.5, agiCeiling: 48500 }, { rate: 0.2, agiCeiling: 52500 }, { rate: 0.1, agiCeiling: 80500 }], single: [], hoh: [] },
  qbi: { thresholdMfj: 403550, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
  amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
  amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
} as unknown as TaxYearParameters;

// MFJ with >=1 qualifying child so `ctc`'s rangeFor doesn't fall into
// NA_RANGE for a household-driven reason (gross <= 0) — rangeFor's own NA
// branches for every OTHER item are structural (filing status / unseeded
// params), not household-driven, so this one household is enough to surface
// every item's real shape.
const household: ThresholdHousehold = {
  filingStatus: "married_joint",
  qualifyingChildren: 1, otherDependents: 0, aotcStudents: 1,
  hasStudentLoanInterest: true, hasRothContribution: true,
  hasTraditionalIraContribution: true, hasQbi: true, hasInvestmentIncome: true,
  coveredSelf: true, coveredSpouse: false,
};

describe("[F1] point-threshold label overrides", () => {
  it("every genuine point-threshold item (end == null, excluding charitableLimit) has a deliberate label override", () => {
    const year = 2026;
    const checked: string[] = [];
    for (const item of THRESHOLD_ITEMS) {
      if (item.id === "charitableLimit") continue; // statusFor() always resolves "full"; never reaches a label override
      const range = rangeFor(item.id, year, params, household.filingStatus, household);
      if (isNaRange(range) || range.end !== null) continue; // not a point threshold for this fixture
      checked.push(item.id);
      // A deliberate override means the label actually differs from the
      // generic default that reads backwards for a burden — merely equaling
      // the default (by omission) would defeat the guard.
      expect(resolveStatusLabel(item.id, "out")).not.toBe("Phased Out");
      expect(resolveStatusLabel(item.id, "full")).not.toBe("Full");
    }
    // Sanity: this fixture must actually exercise at least one point
    // threshold, or the loop above is vacuously true.
    expect(checked).toContain("niit");
  });

  it("niit renders the correct label in both directions", () => {
    // Below the threshold: NIIT does not apply.
    expect(resolveStatusLabel("niit", "full")).toBe("Does Not Apply");
    // At/above the threshold: NIIT applies.
    expect(resolveStatusLabel("niit", "out")).toBe("Applies");
  });

  it("non-point-threshold items keep the generic labels", () => {
    // amtExemption and qbi are genuine phase-outs of a benefit — "Phased
    // Out" is correct for them, and they must NOT have been swept into the
    // override map by an over-broad fix.
    expect(resolveStatusLabel("amtExemption", "out")).toBe("Phased Out");
    expect(resolveStatusLabel("qbi", "full")).toBe("Full");
  });
});
