import { describe, it, expect } from "vitest";
import { computeGiftLedger } from "../gift-ledger";
import type { EntitySummary, GiftEvent } from "../types";

// 1-beneficiary Crummey trust: each split half-gift earns exactly ONE annual
// exclusion (amount − exclusion × 1).
const crummeyTrust1 = {
  id: "trust-1",
  name: "ILIT",
  entityType: "trust",
  isIrrevocable: true,
  crummeyPowers: true,
  beneficiaries: [
    { id: "b1", tier: "primary", percentage: 100, familyMemberId: "k1", sortOrder: 0 },
  ],
} as unknown as EntitySummary;

describe("gift-ledger — joint series split", () => {
  it("splits a joint series cash gift across both grantors (nets to 0 at 2× exclusion)", () => {
    const exclusion = 19_000;
    const ev: GiftEvent = {
      kind: "cash",
      year: 2026,
      amount: 2 * exclusion, // joint max-exclusion gift
      grantor: "joint",
      recipientEntityId: "trust-1",
      useCrummeyPowers: true,
      seriesId: "series-1",
    };
    const ledger = computeGiftLedger({
      planStartYear: 2026,
      planEndYear: 2026,
      hasSpouse: true,
      priorTaxableGifts: { client: 0, spouse: 0 },
      gifts: [],
      giftEvents: [ev],
      entities: [crummeyTrust1],
      annualExclusionsByYear: { 2026: exclusion },
      taxInflationRate: 0,
      accountValueAtYear: () => 0,
    });
    const y = ledger[0];
    expect(y.perGrantor.client.taxableGiftsThisYear).toBe(0);
    expect(y.perGrantor.spouse?.taxableGiftsThisYear).toBe(0);
    expect(y.taxableGiftsGiven).toBe(0);
  });

  it("splits the excess of a joint series gift above 2× exclusion across both grantors", () => {
    const exclusion = 19_000;
    const ev: GiftEvent = {
      kind: "cash",
      year: 2026,
      amount: 2 * exclusion + 10_000, // 5k taxable per grantor
      grantor: "joint",
      recipientEntityId: "trust-1",
      useCrummeyPowers: true,
      seriesId: "series-1",
    };
    const ledger = computeGiftLedger({
      planStartYear: 2026,
      planEndYear: 2026,
      hasSpouse: true,
      priorTaxableGifts: { client: 0, spouse: 0 },
      gifts: [],
      giftEvents: [ev],
      entities: [crummeyTrust1],
      annualExclusionsByYear: { 2026: exclusion },
      taxInflationRate: 0,
      accountValueAtYear: () => 0,
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(5_000);
    expect(ledger[0].perGrantor.spouse?.taxableGiftsThisYear).toBe(5_000);
  });
});
