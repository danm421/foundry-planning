import { describe, it, expect } from "vitest";
import {
  isTrustTerminationYear,
  distributeAtTermination,
} from "../trust-termination";
import type { BeneficiaryRef, EntitySummary } from "@/engine/types";
import { runProjection } from "@/engine/projection";
import {
  buildClutLifecycleFixture,
  CLUT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/clut";

function makeClut(
  overrides: Partial<EntitySummary["splitInterest"]> = {},
): EntitySummary {
  return {
    id: "clut-1",
    name: "Test CLUT",
    entityType: "trust",
    trustSubType: "clut",
    isIrrevocable: true,
    isGrantor: true,
    includeInPortfolio: false,
    grantor: "client",
    splitInterest: {
      inceptionYear: 2026,
      inceptionValue: 1_000_000,
      payoutType: "unitrust",
      payoutPercent: 0.06,
      payoutAmount: null,
      irc7520Rate: 0.06,
      termType: "years",
      termYears: 5,
      measuringLife1Id: null,
      measuringLife2Id: null,
      charityId: "charity-1",
      originalIncomeInterest: 280_000,
      originalRemainderInterest: 720_000,
      ...overrides,
    },
  } as EntitySummary;
}

describe("isTrustTerminationYear", () => {
  it("returns true the year after the last term-year payment for a 'years' CLUT", () => {
    const trust = makeClut({ termType: "years", termYears: 5 });
    // inceptionYear=2026, termYears=5 → payments 2026-2030, termination 2031
    expect(isTrustTerminationYear(trust, 2030, {})).toBe(false);
    expect(isTrustTerminationYear(trust, 2031, {})).toBe(true);
    expect(isTrustTerminationYear(trust, 2032, {})).toBe(false);
  });

  it("returns false for non-CLUT entities", () => {
    const trust = makeClut();
    const notClut = { ...trust, trustSubType: "irrevocable" } as EntitySummary;
    expect(isTrustTerminationYear(notClut, 2031, {})).toBe(false);
  });

  it("returns false when splitInterest is missing", () => {
    const trust = makeClut();
    const stripped = { ...trust, splitInterest: undefined } as EntitySummary;
    expect(isTrustTerminationYear(stripped, 2031, {})).toBe(false);
  });

  it("returns true the year after measuring-life death for single_life", () => {
    const trust = makeClut({
      termType: "single_life",
      termYears: null,
      measuringLife1Id: "fm-life-1",
    });
    expect(isTrustTerminationYear(trust, 2040, { measuringLife1: 2039 })).toBe(true);
    expect(isTrustTerminationYear(trust, 2039, { measuringLife1: 2039 })).toBe(false);
    expect(isTrustTerminationYear(trust, 2041, { measuringLife1: 2039 })).toBe(false);
  });

  it("uses the LATER death for joint_life", () => {
    const trust = makeClut({
      termType: "joint_life",
      termYears: null,
      measuringLife1Id: "fm-1",
      measuringLife2Id: "fm-2",
    });
    expect(
      isTrustTerminationYear(trust, 2050, { measuringLife1: 2040, measuringLife2: 2049 }),
    ).toBe(true);
    expect(
      isTrustTerminationYear(trust, 2041, { measuringLife1: 2040, measuringLife2: 2049 }),
    ).toBe(false);
  });

  it("uses the EARLIER of years-end or life+1 for shorter_of_years_or_life", () => {
    const trust = makeClut({
      termType: "shorter_of_years_or_life",
      termYears: 10,
      measuringLife1Id: "fm-1",
    });
    // years-end = 2026 + 10 = 2036; measuringLife dies 2030 → life-end = 2031
    // min(2036, 2031) = 2031
    expect(isTrustTerminationYear(trust, 2031, { measuringLife1: 2030 })).toBe(true);
    expect(isTrustTerminationYear(trust, 2036, { measuringLife1: 2030 })).toBe(false);
    // No death yet — years leg fires
    expect(isTrustTerminationYear(trust, 2036, {})).toBe(true);
  });
});

describe("distributeAtTermination", () => {
  const trust = makeClut();

  it("distributes pro-rata to primary tier by percentage", () => {
    const designations: BeneficiaryRef[] = [
      { id: "b1", tier: "primary", percentage: 60, familyMemberId: "fm-c1", sortOrder: 0 },
      { id: "b2", tier: "primary", percentage: 40, familyMemberId: "fm-c2", sortOrder: 1 },
    ];
    const result = distributeAtTermination(
      { trust, currentYear: 2031, designations },
      100_000,
    );
    expect(result.totalDistributed).toBeCloseTo(100_000, 2);
    expect(result.toBeneficiaries).toHaveLength(2);
    expect(result.toBeneficiaries[0].amount).toBeCloseTo(60_000, 2);
    expect(result.toBeneficiaries[1].amount).toBeCloseTo(40_000, 2);
    const sum = result.toBeneficiaries.reduce((s, b) => s + b.amount, 0);
    expect(sum).toBeCloseTo(result.totalDistributed, 2);
  });

  it("ignores contingent designations", () => {
    const designations: BeneficiaryRef[] = [
      { id: "b1", tier: "primary", percentage: 100, familyMemberId: "fm-c1", sortOrder: 0 },
      { id: "b2", tier: "contingent", percentage: 100, familyMemberId: "fm-c2", sortOrder: 1 },
    ];
    const result = distributeAtTermination(
      { trust, currentYear: 2031, designations },
      100_000,
    );
    expect(result.toBeneficiaries).toHaveLength(1);
    expect(result.toBeneficiaries[0].amount).toBeCloseTo(100_000, 2);
  });

  it("reconciles rounding drift to the largest share", () => {
    const designations: BeneficiaryRef[] = [
      { id: "b1", tier: "primary", percentage: 33.34, familyMemberId: "fm-c1", sortOrder: 0 },
      { id: "b2", tier: "primary", percentage: 33.33, familyMemberId: "fm-c2", sortOrder: 1 },
      { id: "b3", tier: "primary", percentage: 33.33, familyMemberId: "fm-c3", sortOrder: 2 },
    ];
    const result = distributeAtTermination(
      { trust, currentYear: 2031, designations },
      1000,
    );
    const sum = result.toBeneficiaries.reduce((s, b) => s + b.amount, 0);
    expect(sum).toBeCloseTo(1000, 2);
  });

  it("returns empty distribution list when no primary designations", () => {
    const result = distributeAtTermination(
      { trust, currentYear: 2031, designations: [] },
      100_000,
    );
    expect(result.toBeneficiaries).toEqual([]);
    // totalDistributed reflects the input regardless — caller decides what to
    // do when there are no recipients (typically: log a warning).
    expect(result.totalDistributed).toBe(100_000);
  });
});

describe("CLUT trust-termination integration in projection", () => {
  it("emits trustTerminations on the year after term-end with summed beneficiary amounts", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
      remainderBeneficiaries: [
        { childIndex: 1, percentage: 60 },
        { childIndex: 2, percentage: 40 },
      ],
    });
    const years = runProjection(data);
    const terminationYear = years.find((y) => y.year === 2031)!;
    expect(terminationYear.trustTerminations).toBeDefined();
    expect(terminationYear.trustTerminations).toHaveLength(1);
    const term = terminationYear.trustTerminations![0];
    expect(term.trustId).toBe(CLUT_FIXTURE_IDS.CLUT_ENTITY_ID);
    expect(term.totalDistributed).toBeGreaterThan(0);
    expect(term.toBeneficiaries).toHaveLength(2);
    const sum = term.toBeneficiaries.reduce((s, b) => s + b.amount, 0);
    expect(sum).toBeCloseTo(term.totalDistributed, 2);
  });

  it("does not emit trustTerminations during the term", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    const years = runProjection(data);
    for (let yr = 2026; yr <= 2030; yr++) {
      const y = years.find((r) => r.year === yr)!;
      expect(y.trustTerminations ?? []).toEqual([]);
    }
  });

  it("does not re-emit termination in the year after termination", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
      trailingYears: 3,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    const years = runProjection(data);
    const yr2032 = years.find((y) => y.year === 2032)!;
    expect(yr2032.trustTerminations ?? []).toEqual([]);
  });
});
