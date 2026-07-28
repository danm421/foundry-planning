import { describe, it, expect } from "vitest";
import { rangeFor, statusFor, THRESHOLD_ITEMS } from "../thresholds";
import type { ThresholdFacts, ThresholdHousehold } from "../thresholds";
import type { TaxYearParameters } from "../types";

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

const household: ThresholdHousehold = {
  filingStatus: "married_joint",
  qualifyingChildren: 1, otherDependents: 0, aotcStudents: 1,
  hasStudentLoanInterest: true, hasRothContribution: true,
  hasTraditionalIraContribution: true, hasQbi: true, hasInvestmentIncome: true,
  coveredSelf: true, coveredSpouse: false,
};

const facts = (over: Partial<ThresholdFacts> = {}): ThresholdFacts => ({
  year: 2026, params, household,
  agi: 300000, magiForIraDeduction: 300000, magiForStudentLoan: 300000,
  magiForRoth: 300000, magiForCredits: 300000,
  taxableIncomeBeforeQbi: 300000, amti: 300000, netInvestmentIncome: 50000,
  ...over,
});

describe("rangeFor", () => {
  it("returns the seeded Roth MFJ range", () => {
    expect(rangeFor("rothIra", 2026, params, "married_joint", household))
      .toEqual({ start: 242000, end: 252000 });
  });

  it("returns the statutory MFS range for Roth, ignoring seeded values", () => {
    expect(rangeFor("rothIra", 2026, params, "married_separate", household))
      .toEqual({ start: 0, end: 10000 });
  });

  it("returns the covered range when the contributor is covered", () => {
    expect(rangeFor("iraDeductCovered", 2026, params, "married_joint", household))
      .toEqual({ start: 129000, end: 149000 });
  });

  it("computes the CTC end from the household's child count, not a constant", () => {
    // $400,000 + (1 child x $2,200 / $50) x $1,000 = $444,000
    expect(rangeFor("ctc", 2026, params, "married_joint", { ...household, qualifyingChildren: 1 }))
      .toEqual({ start: 400000, end: 444000 });
    // Two children double the width.
    expect(rangeFor("ctc", 2026, params, "married_joint", { ...household, qualifyingChildren: 2 }))
      .toEqual({ start: 400000, end: 488000 });
  });

  it("returns not-applicable for CTC when no household is supplied", () => {
    expect(Number.isNaN(rangeFor("ctc", 2026, params, "married_joint").start)).toBe(true);
  });

  it("returns a point range for NIIT", () => {
    expect(rangeFor("niit", 2026, params, "married_joint", household))
      .toEqual({ start: 250000, end: null });
  });

  it("derives the AMT exemption end from the 50% OBBBA phaseout rate", () => {
    // start $1,000,000 + exemption $140,200 / 0.5 = $1,280,400
    expect(rangeFor("amtExemption", 2026, params, "married_joint", household))
      .toEqual({ start: 1000000, end: 1280400 });
  });

  it("uses the 25% pre-OBBBA rate for a 2025 year", () => {
    // Same exemption, half the phaseout rate → twice the width.
    expect(rangeFor("amtExemption", 2025, params, "married_joint", household))
      .toEqual({ start: 1000000, end: 1560800 });
  });

  it("returns the QBI threshold plus its phase-in range", () => {
    expect(rangeFor("qbi", 2026, params, "married_joint", household))
      .toEqual({ start: 403550, end: 553550 });
  });

  it("covers every declared item without throwing", () => {
    for (const item of THRESHOLD_ITEMS) {
      expect(() => rangeFor(item.id, 2026, params, "married_joint", household)).not.toThrow();
    }
  });
});

describe("statusFor", () => {
  it("is full below the range start", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 241999 }))).toBe("full");
  });

  it("is full exactly AT the range start", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 242000 }))).toBe("full");
  });

  it("is partial one dollar into the range", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 242001 }))).toBe("partial");
  });

  it("is out exactly AT the range end", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 252000 }))).toBe("out");
  });

  it("is out above the range end", () => {
    expect(statusFor("rothIra", facts({ magiForRoth: 300000 }))).toBe("out");
  });

  it("uses the student-loan MAGI, not the Roth MAGI", () => {
    expect(statusFor("studentLoanInterest", facts({
      magiForStudentLoan: 100000, magiForRoth: 900000,
    }))).toBe("full");
  });

  it("tests taxable income for QBI, not MAGI", () => {
    expect(statusFor("qbi", facts({
      taxableIncomeBeforeQbi: 400000, magiForCredits: 9_000_000,
    }))).toBe("full");
  });

  it("tests AMTI for the AMT exemption", () => {
    expect(statusFor("amtExemption", facts({ amti: 1100000 }))).toBe("partial");
  });

  it("is out above a point threshold (NIIT)", () => {
    expect(statusFor("niit", facts({ agi: 300000 }))).toBe("out");
    expect(statusFor("niit", facts({ agi: 200000 }))).toBe("full");
  });

  it("is na when the household has no qualifying children", () => {
    expect(statusFor("ctc", facts({
      household: { ...household, qualifyingChildren: 0, otherDependents: 0 },
    }))).toBe("na");
  });

  it("is na for the Saver's Credit from 2027 onward", () => {
    expect(statusFor("saversCredit", facts({ year: 2026, agi: 40000 }))).toBe("full");
    expect(statusFor("saversCredit", facts({ year: 2027, agi: 40000 }))).toBe("na");
  });

  it("is na when a required parameter was never seeded", () => {
    const bare = { ...params, rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null } } as TaxYearParameters;
    expect(statusFor("rothIra", facts({ params: bare }))).toBe("na");
  });

  it("is na for the student-loan deduction when filing MFS", () => {
    expect(statusFor("studentLoanInterest", facts({
      household: { ...household, filingStatus: "married_separate" },
    }))).toBe("na");
  });
});
