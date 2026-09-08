import { describe, it, expect } from "vitest";
import { computeExemptionSummary } from "../compute-exemption-summary";

describe("computeExemptionSummary", () => {
  it("attributes per-trust consumed and per-grantor used/total", () => {
    const trust = { id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true, crummeyPowers: false,
      includeInPortfolio: false, isGrantor: false, beneficiaries: [] } as unknown as import("@/engine/types").EntitySummary;
    const summary = computeExemptionSummary({
      giftLedger: [
        { year: 2030, giftsGiven: 100_000, fullValueTransferred: 100_000, taxableGiftsGiven: 100_000,
          perGrantor: { client: { taxableGiftsThisYear: 100_000, cumulativeTaxableGifts: 100_000, creditUsed: 0, giftTaxThisYear: 0, cumulativeGiftTax: 0 } },
          totalGiftTax: 0 },
      ],
      gifts: [],
      giftEvents: [{ kind: "cash", year: 2030, amount: 100_000, grantor: "client", useCrummeyPowers: false, recipientEntityId: "t1", seriesId: "s1" }],
      entities: [trust],
      annualExclusionsByYear: { 2030: 18_000 },
      accountValueAtYear: () => 0,
      taxInflationRate: 0,
    });
    expect(summary.perTrust["t1"]).toEqual({ client: 100_000, spouse: 0 });
    expect(summary.perGrantor.client.used).toBe(100_000);
    expect(summary.perGrantor.client.total).toBeGreaterThan(0);
  });

  it("values an account-percentage gift from the supplied resolver, discounted", () => {
    const trust = { id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true,
      crummeyPowers: false, includeInPortfolio: false, isGrantor: false,
      beneficiaries: [] } as unknown as import("@/engine/types").EntitySummary;
    const summary = computeExemptionSummary({
      giftLedger: [
        { year: 2030, giftsGiven: 70_000, fullValueTransferred: 100_000, taxableGiftsGiven: 70_000,
          perGrantor: { client: { taxableGiftsThisYear: 70_000, cumulativeTaxableGifts: 70_000, creditUsed: 0, giftTaxThisYear: 0, cumulativeGiftTax: 0 } },
          totalGiftTax: 0 },
      ],
      gifts: [],
      giftEvents: [{ kind: "asset", year: 2030, accountId: "acct-1", percent: 0.25,
        grantor: "client", recipientEntityId: "t1", valuationDiscount: 0.3 }],
      entities: [trust],
      annualExclusionsByYear: { 2030: 18_000 },
      accountValueAtYear: (id, y) => (id === "acct-1" && y === 2030 ? 400_000 : 0),
      taxInflationRate: 0,
    });
    // 400,000 × 25% = 100,000 full → 70,000 after a 30% discount.
    expect(summary.perTrust["t1"].client).toBeCloseTo(70_000, 4);
  });
});
