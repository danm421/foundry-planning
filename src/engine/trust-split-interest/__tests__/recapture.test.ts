import { describe, it, expect } from "vitest";
import { computeClutRecapture } from "../recapture";
import { runProjection } from "@/engine/projection";
import {
  buildClutLifecycleFixture,
  CLUT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/clut";

describe("computeClutRecapture", () => {
  it("recapture <= 0 when grantor outlived the term (sanity check)", () => {
    // PV of 10 years of $60K @ 2.2% (annual immediate) ~ $533K — exceeds the
    // original $461K deduction. Caller clamps to >= 0; test confirms math.
    const r = computeClutRecapture({
      originalIncomeInterest: 461_385,
      irc7520Rate: 0.022,
      paymentsByYearOffset: [
        60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000,
        60_000,
      ],
    });
    expect(r.recaptureAmount).toBeLessThanOrEqual(0);
  });

  it("recapture > 0 when grantor dies early in the term", () => {
    const r = computeClutRecapture({
      originalIncomeInterest: 461_385,
      irc7520Rate: 0.022,
      paymentsByYearOffset: [60_000, 60_000],
    });
    // PV of 2 years of $60K @ 2.2% ~ $116,150 → recapture ~$345,235
    expect(r.recaptureAmount).toBeGreaterThan(340_000);
    expect(r.recaptureAmount).toBeLessThan(350_000);
  });

  it("recapture equals original income interest when no payments were made", () => {
    const r = computeClutRecapture({
      originalIncomeInterest: 461_385,
      irc7520Rate: 0.022,
      paymentsByYearOffset: [],
    });
    expect(r.recaptureAmount).toBeCloseTo(461_385, 0);
    expect(r.pvOfPaymentsMade).toBe(0);
  });

  it("returns pvOfPaymentsMade alongside recaptureAmount", () => {
    const r = computeClutRecapture({
      originalIncomeInterest: 100_000,
      irc7520Rate: 0.05,
      paymentsByYearOffset: [50_000],
    });
    // PV of $50K at end of year 1 @ 5% = $50K / 1.05 ≈ $47,619.05
    expect(r.pvOfPaymentsMade).toBeCloseTo(47_619.05, 1);
    expect(r.recaptureAmount).toBeCloseTo(100_000 - 47_619.05, 1);
  });
});

describe("CLUT recapture integration in projection (mid-term grantor death)", () => {
  it("emits clut_recapture into taxDetail.bySource on the grantor's death year", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 15,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 200_000,
      grantorDeathYear: 2030,
      irc7520Rate: 0.022,
    });
    const years = runProjection(data);
    const deathYear = years.find((y) => y.year === 2030)!;
    const recaptureKey = `clut_recapture:${CLUT_FIXTURE_IDS.CLUT_ENTITY_ID}`;
    const recapture = deathYear.taxDetail?.bySource[recaptureKey];
    expect(recapture).toBeDefined();
    expect(recapture!.type).toBe("ordinary_income");
    expect(recapture!.amount).toBeGreaterThan(0);
  });

  it("does not emit recapture when grantor outlives the term", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 200_000,
    });
    const years = runProjection(data);
    for (const y of years) {
      const recaptureKey = `clut_recapture:${CLUT_FIXTURE_IDS.CLUT_ENTITY_ID}`;
      expect(y.taxDetail?.bySource?.[recaptureKey]).toBeUndefined();
    }
  });
});
