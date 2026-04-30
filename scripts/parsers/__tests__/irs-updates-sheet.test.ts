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
    expect(y.capGainsBrackets.married_joint.zeroPctTop).toBe(99200);
    expect(y.capGainsBrackets.married_joint.fifteenPctTop).toBe(615900);
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
    expect(y.qbi.thresholdMfj).toBe(405000);
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
