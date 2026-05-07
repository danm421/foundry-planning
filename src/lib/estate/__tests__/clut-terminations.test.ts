import { describe, it, expect } from "vitest";
import { extractClutTerminations } from "../transfer-report";
import { runProjectionWithEvents } from "@/engine/projection";
import {
  buildClutLifecycleFixture,
  CLUT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/clut";

describe("extractClutTerminations", () => {
  it("flattens trustTerminations across all years into a single list", () => {
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
    const projection = runProjectionWithEvents(data);
    const terminations = extractClutTerminations(projection);
    expect(terminations).toHaveLength(1);
    expect(terminations[0].trustId).toBe(CLUT_FIXTURE_IDS.CLUT_ENTITY_ID);
    expect(terminations[0].year).toBe(2031);
    expect(terminations[0].totalDistributed).toBeGreaterThan(0);
    expect(terminations[0].toBeneficiaries).toHaveLength(2);
  });

  it("returns empty list when projection ends before any termination fires", () => {
    // termYears=10, trailingYears=-5 → planEnd = 2026 + 10 - 5 = 2031.
    // Last payment year = 2026..2030; termination year = 2036; plan ends 2031,
    // so no termination row. Wait: termination year for a 10y term is 2036,
    // but planEnd=2031 means we never reach it.
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 10,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
      trailingYears: -5,
    });
    const projection = runProjectionWithEvents(data);
    const terminations = extractClutTerminations(projection);
    expect(terminations).toEqual([]);
  });
});
