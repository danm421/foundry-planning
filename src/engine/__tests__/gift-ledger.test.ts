import { describe, it, expect } from "vitest";
import { computeGiftLedger } from "../gift-ledger";
import type { Gift, GiftEvent } from "../types";

const noAccountValue = () => 0;

const baseInput = {
  planStartYear: 2026,
  planEndYear: 2030,
  hasSpouse: true,
  priorTaxableGifts: { client: 0, spouse: 0 },
  gifts: [] as Gift[],
  giftEvents: [] as GiftEvent[],
  externalBeneficiaryKindById: new Map<string, "charity" | "individual">(),
  annualExclusionsByYear: { 2026: 19_000, 2027: 19_000, 2028: 20_000, 2029: 20_000, 2030: 20_000 },
  taxInflationRate: 0.025,
  accountValueAtYear: noAccountValue,
};

describe("computeGiftLedger", () => {
  it("returns one entry per plan year with all-zero state when no gifts and no priors", () => {
    const ledger = computeGiftLedger(baseInput);
    expect(ledger).toHaveLength(5);
    expect(ledger[0].year).toBe(2026);
    expect(ledger[4].year).toBe(2030);
    for (const row of ledger) {
      expect(row.giftsGiven).toBe(0);
      expect(row.taxableGiftsGiven).toBe(0);
      expect(row.totalGiftTax).toBe(0);
      expect(row.perGrantor.client.cumulativeTaxableGifts).toBe(0);
      expect(row.perGrantor.client.creditUsed).toBe(0);
      expect(row.perGrantor.client.giftTaxThisYear).toBe(0);
      expect(row.perGrantor.client.cumulativeGiftTax).toBe(0);
      expect(row.perGrantor.spouse).toBeDefined();
      expect(row.perGrantor.spouse?.cumulativeTaxableGifts).toBe(0);
    }
  });
});
