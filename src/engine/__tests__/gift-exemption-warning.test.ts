import { describe, it, expect } from "vitest";
import { checkExemptionImpact } from "../gift-exemption-warning";
import type { GiftLedgerYear } from "../gift-ledger";

function ledgerRow(over: Partial<GiftLedgerYear> = {}): GiftLedgerYear {
  return {
    year: 2030,
    giftsGiven: 0,
    taxableGiftsGiven: 0,
    perGrantor: {
      client: {
        taxableGiftsThisYear: 0,
        cumulativeTaxableGifts: 0,
        creditUsed: 0,
        giftTaxThisYear: 0,
        cumulativeGiftTax: 0,
      },
      spouse: {
        taxableGiftsThisYear: 0,
        cumulativeTaxableGifts: 0,
        creditUsed: 0,
        giftTaxThisYear: 0,
        cumulativeGiftTax: 0,
      },
    },
    totalGiftTax: 0,
    ...over,
  };
}

describe("checkExemptionImpact", () => {
  it("returns no breach when proposed gift fits entirely within remaining BEA", () => {
    const result = checkExemptionImpact({
      ledger: [ledgerRow()],
      proposed: { grantor: "client", year: 2030, taxableContribution: 50_000 },
      taxInflationRate: 0.025,
    });
    expect(result.exceeds).toBe(false);
    expect(result.perGrantor.client?.overage).toBe(0);
    expect(result.perGrantor.client?.estimatedTax).toBe(0);
  });

  it("flags breach when proposed gift pushes cumulative above BEA", () => {
    const baseline = ledgerRow({
      perGrantor: {
        client: {
          taxableGiftsThisYear: 0,
          cumulativeTaxableGifts: 14_000_000,
          creditUsed: 5_545_800,
          giftTaxThisYear: 0,
          cumulativeGiftTax: 0,
        },
        spouse: ledgerRow().perGrantor.spouse,
      },
    });
    const result = checkExemptionImpact({
      ledger: [baseline],
      proposed: { grantor: "client", year: 2030, taxableContribution: 20_000_000 },
      taxInflationRate: 0.025,
    });
    expect(result.exceeds).toBe(true);
    expect(result.perGrantor.client?.overage).toBeGreaterThan(0);
    expect(result.perGrantor.client?.estimatedTax).toBeGreaterThan(0);
    expect(result.perGrantor.client!.estimatedTax).toBeGreaterThan(
      result.perGrantor.client!.overage * 0.39,
    );
  });

  it("splits joint-grantor gifts 50/50 across spouses", () => {
    const baseline = ledgerRow({
      perGrantor: {
        client: {
          taxableGiftsThisYear: 0,
          cumulativeTaxableGifts: 14_000_000,
          creditUsed: 5_545_800,
          giftTaxThisYear: 0,
          cumulativeGiftTax: 0,
        },
        spouse: ledgerRow().perGrantor.spouse,
      },
    });
    const result = checkExemptionImpact({
      ledger: [baseline],
      proposed: { grantor: "joint", year: 2030, taxableContribution: 4_000_000 },
      taxInflationRate: 0.025,
    });
    expect(result.perGrantor.spouse?.overage ?? 0).toBe(0);
    if (result.exceeds) {
      expect(result.perGrantor.client?.overage).toBeGreaterThan(0);
    }
  });

  it("returns no perGrantor entry for grantors with no proposed share", () => {
    const result = checkExemptionImpact({
      ledger: [ledgerRow()],
      proposed: { grantor: "client", year: 2030, taxableContribution: 50_000 },
      taxInflationRate: 0.025,
    });
    expect(result.perGrantor.spouse).toBeUndefined();
    expect(result.perGrantor.client).toBeDefined();
  });

  it("treats missing year-row in ledger as a zero baseline", () => {
    const result = checkExemptionImpact({
      ledger: [ledgerRow({ year: 2030 })],
      proposed: { grantor: "client", year: 2099, taxableContribution: 50_000 },
      taxInflationRate: 0.025,
    });
    expect(result.exceeds).toBe(false);
  });

  it("uses ledger's cumulativeTaxableGifts as the 'before proposed' baseline", () => {
    // Existing row has $1M client taxable for the year on top of $5M prior.
    // Proposed adds $500K more. cumulativeAfter = 6M + 500K = 6.5M.
    const baseline = ledgerRow({
      perGrantor: {
        client: {
          taxableGiftsThisYear: 1_000_000,
          cumulativeTaxableGifts: 6_000_000,
          creditUsed: 2_185_800,
          giftTaxThisYear: 0,
          cumulativeGiftTax: 0,
        },
        spouse: ledgerRow().perGrantor.spouse,
      },
    });
    const result = checkExemptionImpact({
      ledger: [baseline],
      proposed: { grantor: "client", year: 2030, taxableContribution: 500_000 },
      taxInflationRate: 0.025,
    });
    expect(result.perGrantor.client?.cumulativeAfter).toBe(6_500_000);
  });
});
