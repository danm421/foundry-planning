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

// Seeded data/medicare-irmaa-2024-2026.json MFJ-2024 — adjacent tiers SHARE
// the boundary value (tier 1 upper === tier 2 lower === 258000), which is what
// makes the threshold-exact case load-bearing for the IRMAA cliff.
const MFJ_2024: IrmaaTier[] = [
  { tier: 1, magiLowerBound: 206000, magiUpperBound: 258000, partBSurcharge: 838.80,  partDSurcharge: 150.60 },
  { tier: 2, magiLowerBound: 258000, magiUpperBound: 322000, partBSurcharge: 2096.40, partDSurcharge: 389.40 },
  { tier: 3, magiLowerBound: 322000, magiUpperBound: 386000, partBSurcharge: 3354.00, partDSurcharge: 628.20 },
  { tier: 4, magiLowerBound: 386000, magiUpperBound: 750000, partBSurcharge: 4612.80, partDSurcharge: 867.00 },
  { tier: 5, magiLowerBound: 750000, magiUpperBound: null,   partBSurcharge: 5031.00, partDSurcharge: 946.80 },
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

  it("passes through caller-supplied standardPartBPremium unchanged", () => {
    const result = computeMedicareYear(baseInput({ year: 2030, standardPartBPremium: 3000 }));
    expect(result.partBStandardPremium).toBe(3000);
  });
});

// IRMAA is a hard cliff and adjacent tiers share their boundary value, so a
// MAGI exactly on a published threshold must stay in the LOWER tier. CMS/SSA
// (20 CFR 418.2120): each surcharge tier is MAGI > lower AND MAGI <= upper,
// standard premium for MAGI <= the first threshold.
describe("computeMedicareYear — IRMAA tier boundary inclusivity (MFJ 2024)", () => {
  const irmaa2024 = (sourceMagi: number) =>
    computeMedicareYear(
      baseInput({
        irmaaTiers: { mfj: MFJ_2024, single: SINGLE_2026 },
        filingStatus: "mfj",
        standardPartBPremium: 2098.80,
        sourceMagi,
      }),
    );

  it("MAGI exactly on the shared tier-1/tier-2 boundary (258000) stays in tier 1", () => {
    const result = irmaa2024(258_000);
    expect(result.irmaaTier).toBe(1);
    expect(result.partBIrmaaSurcharge).toBe(838.80);
    expect(result.partDIrmaaSurcharge).toBe(150.60);
    // not tier-2's 2096.40 / 389.40
    expect(result.partBIrmaaSurcharge).not.toBe(2096.40);
    expect(result.partDIrmaaSurcharge).not.toBe(389.40);
  });

  it("MAGI exactly on the tier-0/tier-1 divider (206000) stays in tier 0, no surcharge", () => {
    const result = irmaa2024(206_000);
    expect(result.irmaaTier).toBe(0);
    expect(result.partBIrmaaSurcharge).toBe(0);
    expect(result.partDIrmaaSurcharge).toBe(0);
  });

  it("MAGI one dollar below the tier-0/tier-1 divider (205999) is tier 0", () => {
    const result = irmaa2024(205_999);
    expect(result.irmaaTier).toBe(0);
    expect(result.partBIrmaaSurcharge).toBe(0);
  });

  it("MAGI one dollar above the tier-0/tier-1 divider (206001) is tier 1", () => {
    const result = irmaa2024(206_001);
    expect(result.irmaaTier).toBe(1);
    expect(result.partBIrmaaSurcharge).toBe(838.80);
  });

  it("headroom from a threshold-exact MAGI reads as distance to the next cliff", () => {
    // 258000 is tier 1 (upper 258000); headroom to the tier-2 cliff is 0.
    const onBoundary = irmaa2024(258_000);
    expect(onBoundary.headroomToNextTier).toBe(0);
    // Mid-tier-1 MAGI: 230000 → tier 1, headroom = 258000 - 230000 = 28000.
    const midTier = irmaa2024(230_000);
    expect(midTier.irmaaTier).toBe(1);
    expect(midTier.headroomToNextTier).toBe(28_000);
  });
});
