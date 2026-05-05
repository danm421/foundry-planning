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

  it("seeds year 1 cumulative from priorTaxableGifts and carries forward when no in-plan gifts", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      priorTaxableGifts: { client: 1_120_000, spouse: 0 },
    });
    expect(ledger[0].perGrantor.client.cumulativeTaxableGifts).toBe(1_120_000);
    // applyUnifiedRateSchedule(1_120_000) = 345_800 + 0.40 * 120_000 = 393_800
    expect(ledger[0].perGrantor.client.creditUsed).toBeCloseTo(393_800, 2);
    expect(ledger[0].perGrantor.client.giftTaxThisYear).toBe(0);
    // Carries forward unchanged
    expect(ledger[4].perGrantor.client.cumulativeTaxableGifts).toBe(1_120_000);
    expect(ledger[4].perGrantor.client.creditUsed).toBeCloseTo(393_800, 2);
    expect(ledger[0].perGrantor.spouse?.cumulativeTaxableGifts).toBe(0);
  });

  function gift(over: Partial<Gift> = {}): Gift {
    return {
      id: "g1",
      year: 2026,
      amount: 100_000,
      grantor: "client",
      recipientFamilyMemberId: "fm1",
      recipientEntityId: undefined,
      recipientExternalBeneficiaryId: undefined,
      useCrummeyPowers: false,
      notes: undefined,
      ...over,
    } as Gift;
  }

  it("applies annual exclusion to a single-grantor cash gift", () => {
    // 100k − 19k AE = 81k taxable to client only
    const ledger = computeGiftLedger({
      ...baseInput,
      gifts: [gift({ year: 2026, amount: 100_000, grantor: "client" })],
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBeCloseTo(81_000, 2);
    expect(ledger[0].perGrantor.client.cumulativeTaxableGifts).toBeCloseTo(81_000, 2);
    expect(ledger[0].perGrantor.spouse?.taxableGiftsThisYear).toBe(0);
    expect(ledger[0].taxableGiftsGiven).toBeCloseTo(81_000, 2);
  });

  it("returns 0 taxable when gift is fully under annual exclusion", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      gifts: [gift({ year: 2026, amount: 15_000, grantor: "client" })],
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(0);
    expect(ledger[0].perGrantor.client.cumulativeTaxableGifts).toBe(0);
  });

  it("splits joint cash gifts 50/50 with each spouse's AE applied separately", () => {
    // $50k joint → $25k each − $20k AE (using 2028 exclusion) = $5k each
    const ledger = computeGiftLedger({
      ...baseInput,
      gifts: [gift({ year: 2028, amount: 50_000, grantor: "joint" })],
    });
    const row2028 = ledger.find((r) => r.year === 2028)!;
    expect(row2028.perGrantor.client.taxableGiftsThisYear).toBeCloseTo(5_000, 2);
    expect(row2028.perGrantor.spouse?.taxableGiftsThisYear).toBeCloseTo(5_000, 2);
    expect(row2028.taxableGiftsGiven).toBeCloseTo(10_000, 2);
  });

  it("ignores gifts whose grantor doesn't match either spouse (defensive)", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      // Cast to unblock the test fixture even though the type union doesn't permit this.
      gifts: [{ ...gift(), grantor: "other" } as unknown as Gift],
    });
    expect(ledger[0].taxableGiftsGiven).toBe(0);
  });

  it("treats charitable cash gifts as 0 taxable (full charitable deduction)", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      gifts: [
        gift({
          year: 2026,
          amount: 500_000,
          grantor: "client",
          recipientFamilyMemberId: undefined,
          recipientExternalBeneficiaryId: "ext-charity-1",
        }),
      ],
      externalBeneficiaryKindById: new Map([["ext-charity-1", "charity"]]),
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(0);
    expect(ledger[0].taxableGiftsGiven).toBe(0);
  });
});
