import { describe, it, expect } from "vitest";
import { computeMedicareYear, type MedicareYearInput } from "../medicare";
import type { IrmaaTier } from "../types";

const MFJ_2026: IrmaaTier[] = [
  { tier: 1, magiLowerBound: 218000, magiUpperBound: 274000, partBSurcharge: 940,  partDSurcharge: 174  },
  { tier: 2, magiLowerBound: 274000, magiUpperBound: 344000, partBSurcharge: 2350, partDSurcharge: 450  },
  { tier: 3, magiLowerBound: 344000, magiUpperBound: 412000, partBSurcharge: 3760, partDSurcharge: 726  },
  { tier: 4, magiLowerBound: 412000, magiUpperBound: 750000, partBSurcharge: 5170, partDSurcharge: 1002 },
  { tier: 5, magiLowerBound: 750000, magiUpperBound: null,   partBSurcharge: 5640, partDSurcharge: 1094 },
];
const SINGLE_2026: IrmaaTier[] = [
  { tier: 1, magiLowerBound: 109000, magiUpperBound: 137000, partBSurcharge: 940,  partDSurcharge: 174  },
  { tier: 2, magiLowerBound: 137000, magiUpperBound: 172000, partBSurcharge: 2350, partDSurcharge: 450  },
  { tier: 3, magiLowerBound: 172000, magiUpperBound: 206000, partBSurcharge: 3760, partDSurcharge: 726  },
  { tier: 4, magiLowerBound: 206000, magiUpperBound: 500000, partBSurcharge: 5170, partDSurcharge: 1002 },
  { tier: 5, magiLowerBound: 500000, magiUpperBound: null,   partBSurcharge: 5640, partDSurcharge: 1094 },
];

function baseInput(overrides: Partial<MedicareYearInput> = {}): MedicareYearInput {
  return {
    year: 2026,
    owner: "client",
    age: 70,
    coverage: {
      owner: "client",
      enrollmentYear: 2021,
      coverageType: "original",
      medigapMonthlyAt65: null,
      partDPlanMonthlyAt65: null,
      priorYearMagi: null,
    },
    standardPartBPremium: 2350,
    partDNationalBase: 467,
    irmaaTiers: { mfj: MFJ_2026, single: SINGLE_2026 },
    filingStatus: "mfj",
    sourceMagi: 150_000,
    sourceYearForIrmaa: 2024,
    isColdStart: false,
    medicareBaseYear: 2025,
    medicarePremiumInflationRate: 0.05,
    defaultMedigapMonthly: 170,
    defaultPartDPlanMonthly: 46,
    ...overrides,
  };
}

describe("computeMedicareYear", () => {
  it("returns enrolled=false when age below enrollment age", () => {
    const result = computeMedicareYear(baseInput({ age: 60 }));
    expect(result.enrolled).toBe(false);
    expect(result.totalAnnualCost).toBe(0);
  });

  it("returns enrolled=false when year below enrollmentYear (deferred)", () => {
    const result = computeMedicareYear(baseInput({
      year: 2025,
      coverage: { ...baseInput().coverage, enrollmentYear: 2030 },
    }));
    expect(result.enrolled).toBe(false);
  });

  it("MAGI below tier 1 → tier 0, no surcharge", () => {
    const result = computeMedicareYear(baseInput({ sourceMagi: 150_000 }));
    expect(result.irmaaTier).toBe(0);
    expect(result.partBIrmaaSurcharge).toBe(0);
    expect(result.partDIrmaaSurcharge).toBe(0);
    expect(result.partBStandardPremium).toBe(2350);
    expect(result.partBPremium).toBe(2350);
  });

  it("MAGI at tier 2 MFJ → tier 2 surcharges applied", () => {
    const result = computeMedicareYear(baseInput({ sourceMagi: 300_000 }));
    expect(result.irmaaTier).toBe(2);
    expect(result.partBIrmaaSurcharge).toBe(2350);
    expect(result.partDIrmaaSurcharge).toBe(450);
    expect(result.partBPremium).toBe(2350 + 2350);
  });

  it("MAGI in single tier 3 when filingStatus=single", () => {
    const result = computeMedicareYear(baseInput({
      filingStatus: "single",
      sourceMagi: 180_000,
    }));
    expect(result.irmaaTier).toBe(3);
    expect(result.irmaaFilingStatus).toBe("single");
  });

  it("top tier has Infinity headroom", () => {
    const result = computeMedicareYear(baseInput({ sourceMagi: 900_000 }));
    expect(result.irmaaTier).toBe(5);
    expect(result.headroomToNextTier).toBe(Infinity);
  });

  it("headroom = next threshold - sourceMagi at sub-top tiers", () => {
    const result = computeMedicareYear(baseInput({ sourceMagi: 300_000 }));
    expect(result.headroomToNextTier).toBe(44_000);
  });

  it("inflates Medigap from base-year default", () => {
    const result = computeMedicareYear(baseInput({ year: 2026 }));
    const expectedMedigap = 170 * 12 * 1.05;
    expect(result.medigapPremium).toBeCloseTo(expectedMedigap, 2);
  });

  it("uses Medigap override when provided", () => {
    const result = computeMedicareYear(baseInput({
      coverage: { ...baseInput().coverage, medigapMonthlyAt65: 250 },
    }));
    expect(result.medigapPremium).toBeCloseTo(250 * 12 * 1.05, 2);
  });

  it("inflates standardPartBPremium when year > seeded year", () => {
    const result = computeMedicareYear(baseInput({ year: 2030, standardPartBPremium: 3000 }));
    expect(result.partBStandardPremium).toBe(3000);
  });
});
