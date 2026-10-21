import { describe, it, expect } from "vitest";
import type { Gift, GiftEvent } from "@/engine/types";
import { cumulativeCharityGifts } from "../yearly-estate-report";

const CHARITY_ID = "c1";
const charityIds = new Set([CHARITY_ID]);
const NO_QCDS: ReadonlyMap<number, number> = new Map();

function seriesEvent(
  year: number,
  amount: number,
  recipientExternalBeneficiaryId = CHARITY_ID,
): GiftEvent {
  return {
    kind: "cash",
    year,
    amount,
    grantor: "client",
    recipientExternalBeneficiaryId,
    useCrummeyPowers: false,
    seriesId: "s1",
  };
}

describe("cumulativeCharityGifts", () => {
  it("sums each recurring occurrence given by the year", () => {
    const events = [seriesEvent(2026, 10_000), seriesEvent(2027, 10_000)];
    expect(cumulativeCharityGifts([], events, charityIds, 2027, 0, NO_QCDS)).toBe(20_000);
    expect(cumulativeCharityGifts([], events, charityIds, 2026, 0, NO_QCDS)).toBe(10_000);
  });

  it("grows earlier occurrences at inflation", () => {
    const events = [seriesEvent(2026, 10_000), seriesEvent(2027, 10_000)];
    expect(cumulativeCharityGifts([], events, charityIds, 2027, 0.1, NO_QCDS)).toBeCloseTo(
      10_000 * 1.1 + 10_000,
    );
  });

  it("counts a one-time gift present in both gifts and giftEvents once", () => {
    const gifts: Gift[] = [
      {
        id: "gift-1",
        year: 2026,
        amount: 5_000,
        grantor: "client",
        recipientExternalBeneficiaryId: CHARITY_ID,
        useCrummeyPowers: false,
      },
    ];
    const events: GiftEvent[] = [
      {
        kind: "cash",
        year: 2026,
        amount: 5_000,
        grantor: "client",
        recipientExternalBeneficiaryId: CHARITY_ID,
        useCrummeyPowers: false,
        sourceGiftId: "gift-1",
      },
    ];
    expect(cumulativeCharityGifts(gifts, events, charityIds, 2026, 0, NO_QCDS)).toBe(5_000);
  });

  it("ignores a recurring gift to an external beneficiary that is not a charity", () => {
    const events = [seriesEvent(2026, 10_000, "not-a-charity")];
    expect(cumulativeCharityGifts([], events, charityIds, 2026, 0, NO_QCDS)).toBe(0);
  });

  it("adds QCD dollars (qualifying + taxed excess) for each year up to N", () => {
    const qcdByYear = new Map([
      [2026, 40_000],
      [2027, 41_000],
    ]);
    expect(cumulativeCharityGifts([], [], charityIds, 2027, 0, qcdByYear)).toBe(81_000);
    expect(cumulativeCharityGifts([], [], charityIds, 2026, 0, qcdByYear)).toBe(40_000);
  });

  it("grows earlier QCD years at inflation like cash gifts", () => {
    const qcdByYear = new Map([
      [2026, 40_000],
      [2027, 41_000],
    ]);
    expect(cumulativeCharityGifts([], [], charityIds, 2027, 0.1, qcdByYear)).toBeCloseTo(
      40_000 * 1.1 + 41_000,
    );
  });
});
