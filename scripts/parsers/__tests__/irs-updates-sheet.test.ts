import { describe, it, expect, beforeAll } from "vitest";
import { parseIrsUpdatesSheet } from "../irs-updates-sheet";
import path from "node:path";
import type { TaxYearParameters } from "../../../src/lib/tax/types";

const FIXTURE = path.join(process.cwd(), "data/tax/2022-2026 Tax Values Updated.xlsx");

describe("parseIrsUpdatesSheet", () => {
  let years: TaxYearParameters[];
  beforeAll(async () => {
    years = await parseIrsUpdatesSheet(FIXTURE);
  });

  it("produces one row per tax year 2022-2026", () => {
    expect(years.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("correctly parses 2026 standard deduction", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.stdDeduction.married_joint).toBe(32200);
    expect(y.stdDeduction.single).toBe(16100);
    expect(y.stdDeduction.head_of_household).toBe(24150);
    expect(y.stdDeduction.married_separate).toBe(16100);
  });

  it("correctly parses 2026 SS wage base", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.ssWageBase).toBe(184500);
    expect(y.ssTaxRate).toBeCloseTo(0.062, 4);
    expect(y.medicareTaxRate).toBeCloseTo(0.0145, 4);
  });

  it("correctly parses 2026 income brackets MFJ", () => {
    const y = years.find((y) => y.year === 2026)!;
    const mfj = y.incomeBrackets.married_joint;
    expect(mfj).toHaveLength(7);
    expect(mfj[0]).toEqual({ from: 0, to: 24800, rate: 0.10 });
    expect(mfj[1]).toEqual({ from: 24800, to: 100800, rate: 0.12 });
    expect(mfj[6]).toEqual({ from: 768700, to: null, rate: 0.37 });
  });

  it("correctly parses 2026 cap gains brackets MFJ", () => {
    const y = years.find((y) => y.year === 2026)!;
    // 98900/613700, not the 99200/615900 this previously asserted. The WORKBOOK won,
    // not the test: Rev. Proc. 2025-32 sec. 4.03 "Maximum Capital Gains Rate
    // (IRC 1(h), 1(j)(5))" publishes the 2026 maximum-zero-rate and maximum-15%-rate
    // amounts for joint returns as exactly $98,900 and $613,700. Unlike the QBI case
    // below, the sheet was right and this test was the stale party — it was written
    // (88bb1cb1c) against the pre-correction workbook and was orphaned by c493eecdd,
    // which fixed the sheet but left the expectation behind.
    expect(y.capGainsBrackets.married_joint.zeroPctTop).toBe(98900);
    expect(y.capGainsBrackets.married_joint.fifteenPctTop).toBe(613700);
  });

  // The MFJ row above is not a lucky single match: every filing status in the same
  // Rev. Proc. 2025-32 sec. 4.03 table agrees with the workbook, which is what rules
  // out a transcription slip in the one row the engine happens to lean on hardest.
  // This is a cross-check against published figures, not a restatement of the parser.
  it("matches the published 2026 cap gains table for every filing status", () => {
    const cg = years.find((y) => y.year === 2026)!.capGainsBrackets;
    expect(cg.single).toEqual({ zeroPctTop: 49450, fifteenPctTop: 545500 });
    expect(cg.head_of_household).toEqual({ zeroPctTop: 66200, fifteenPctTop: 579600 });
    expect(cg.married_separate).toEqual({ zeroPctTop: 49450, fifteenPctTop: 306850 });
    // IRC 1(j)(5)(B)(i) sets the joint maximum-zero-rate amount at 2x the single
    // amount, and 2 x 49450 = 98900. The old 99200 would have required single =
    // 49600, contradicting the single figure in the very same published table.
    expect(cg.married_joint.zeroPctTop).toBe(cg.single.zeroPctTop * 2);
  });

  it("correctly parses 2026 AMT exemption", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.amtExemption.mfj).toBe(140200);
    expect(y.amtExemption.singleHoh).toBe(90100);
    expect(y.amtExemption.mfs).toBe(70100);
  });

  it("correctly parses 2026 AMT phase-out start", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.amtPhaseoutStart.mfj).toBe(1000000);
    expect(y.amtPhaseoutStart.singleHoh).toBe(500000);
  });

  it("populates statutory-fixed NIIT thresholds", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.niitRate).toBeCloseTo(0.038, 4);
    expect(y.niitThreshold.mfj).toBe(250000);
    expect(y.niitThreshold.single).toBe(200000);
    expect(y.niitThreshold.mfs).toBe(125000);
  });

  it("correctly parses 2026 QBI thresholds and phase-in ranges", () => {
    const y = years.find((y) => y.year === 2026)!;
    // 403550, not the 405000 this previously asserted. Deliberate correction, not a
    // regression: IRC 199A(e)(2)(B) fixes the MFJ threshold at 200% of the single
    // threshold, and 2 x 201775 = 403550. The workbook's old 405000 was a stray value.
    expect(y.qbi.thresholdMfj).toBe(403550);
    expect(y.qbi.thresholdSingleHohMfs).toBe(201775);
    expect(y.qbi.phaseInRangeMfj).toBe(150000);
    expect(y.qbi.phaseInRangeOther).toBe(75000);
  });

  it("correctly parses 2026 contribution limits", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.contribLimits.ira401kElective).toBe(24500);
    expect(y.contribLimits.ira401kCatchup50).toBe(8000);
    expect(y.contribLimits.ira401kCatchup6063).toBe(11250);
    expect(y.contribLimits.iraTradLimit).toBe(7500);
    expect(y.contribLimits.iraCatchup50).toBe(1000);
    expect(y.contribLimits.hsaLimitSelf).toBe(4400);
    expect(y.contribLimits.hsaLimitFamily).toBe(8750);
  });

  it("returns null for super catch-up in pre-2025 years", () => {
    const y2022 = years.find((y) => y.year === 2022)!;
    expect(y2022.contribLimits.ira401kCatchup6063).toBeNull();
  });
});

describe("parseIrsUpdatesSheet — threshold sections", () => {
  let years: TaxYearParameters[];
  beforeAll(async () => {
    years = await parseIrsUpdatesSheet(FIXTURE);
  });

  it("parses 2026 Roth and IRA-deductibility ranges", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.rothPhaseout.startMfj).toBe(242000);
    expect(y.rothPhaseout.endMfj).toBe(252000);
    expect(y.iraDeduct.coveredStartMfj).toBe(129000);
    expect(y.iraDeduct.spousalEndMfj).toBe(252000);
  });

  it("parses the 2026 student-loan cap and range", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.studentLoan.maxDeduction).toBe(2500);
    expect(y.studentLoan.startMfj).toBe(175000);
    expect(y.studentLoan.endMfj).toBe(205000);
  });

  it("parses 2026 CTC amounts and Saver's tiers", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.ctc.perChild).toBe(2200);
    expect(y.saversCredit.mfj).toHaveLength(3);
    expect(y.saversCredit.mfj[2].agiCeiling).toBe(80500);
  });

  it("corrects the QBI 2026 MFJ threshold to exactly 2x the single threshold", () => {
    const y = years.find((y) => y.year === 2026)!;
    // IRC 199A(e)(2): the MFJ threshold IS twice the single threshold.
    expect(y.qbi.thresholdMfj).toBe(y.qbi.thresholdSingleHohMfs * 2);
    expect(y.qbi.thresholdMfj).toBe(403550);
  });

  // parseSection matches section headers by String.includes, so a new section title
  // that is a substring of an existing one would silently read the wrong rows.
  // "Traditional IRA Deduction Phase-out" vs the pre-existing "Traditional & Roth IRA
  // Contribution Limits" is the near-miss. Assert both resolve to their own rows.
  it("does not collide the IRA deduction section with the IRA contribution section", () => {
    const y = years.find((y) => y.year === 2026)!;
    // Phase-out MAGI floor, not a contribution limit.
    expect(y.iraDeduct.coveredStartMfj).toBe(129000);
    // The contribution section still parses independently and is unchanged.
    expect(y.contribLimits.iraTradLimit).toBe(7500);
    expect(y.contribLimits.iraCatchup50).toBe(1000);
  });

  it("derives Saver's Credit single and HoH ceilings from the MFJ figures", () => {
    const y = years.find((y) => y.year === 2026)!;
    // IRC 25B(b)(2): HoH ceilings are 75% of joint, all other filers 50%. These
    // exact figures appear in IRS Notice 2025-67, so this is a real cross-check
    // against published values, not a restatement of the formula.
    expect(y.saversCredit.single.map((t) => t.agiCeiling)).toEqual([24250, 26250, 40250]);
    expect(y.saversCredit.hoh.map((t) => t.agiCeiling)).toEqual([36375, 39375, 60375]);
    expect(y.saversCredit.mfj.map((t) => t.rate)).toEqual([0.5, 0.2, 0.1]);
  });

  it("populates the new blocks for every year, not just 2026", () => {
    for (const y of years) {
      expect(y.rothPhaseout.startMfj).toBeGreaterThan(0);
      expect(y.iraDeduct.coveredStartMfj).toBeGreaterThan(0);
      expect(y.studentLoan.maxDeduction).toBe(2500);
      expect(y.ctc.perChild).toBeGreaterThan(0);
      expect(y.saversCredit.mfj).toHaveLength(3);
    }
  });
});
