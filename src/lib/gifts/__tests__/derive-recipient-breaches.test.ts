import { describe, it, expect } from "vitest";
import { deriveRecipientBreaches } from "../derive-recipient-breaches";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { Gift } from "@/engine/types";

const breachYear: GiftLedgerYear = {
  year: 2032,
  giftsGiven: 20_000_000,
  taxableGiftsGiven: 19_980_000,
  perGrantor: {
    client: { taxableGiftsThisYear: 19_980_000, cumulativeTaxableGifts: 20_000_000, creditUsed: 7_637_800, giftTaxThisYear: 800_000, cumulativeGiftTax: 800_000 },
    spouse: { taxableGiftsThisYear: 0, cumulativeTaxableGifts: 0, creditUsed: 0, giftTaxThisYear: 0, cumulativeGiftTax: 0 },
  },
  totalGiftTax: 800_000,
};

const cleanYear: GiftLedgerYear = {
  ...breachYear,
  year: 2030,
  totalGiftTax: 0,
  perGrantor: {
    client: { ...breachYear.perGrantor.client, giftTaxThisYear: 0 },
    spouse: breachYear.perGrantor.spouse,
  },
};

describe("deriveRecipientBreaches", () => {
  it("flags recipients whose incoming gift lands in a breach year", () => {
    const gift: Gift = { id: "g1", year: 2032, amount: 20_000_000, grantor: "client", recipientEntityId: "trust-1" } as Gift;
    const map = deriveRecipientBreaches({ ledger: [breachYear], gifts: [gift], giftEvents: [] });
    expect(map.get("entity:trust-1")).toBe(true);
  });

  it("does not flag recipients whose gifts land in clean years", () => {
    const gift: Gift = { id: "g1", year: 2030, amount: 50_000, grantor: "client", recipientEntityId: "trust-1" } as Gift;
    const map = deriveRecipientBreaches({ ledger: [cleanYear], gifts: [gift], giftEvents: [] });
    expect(map.get("entity:trust-1")).toBeFalsy();
  });

  it("returns separate keys for the three recipient kinds", () => {
    const gifts: Gift[] = [
      { id: "g1", year: 2032, amount: 1_000_000, grantor: "client", recipientEntityId: "trust-1" } as Gift,
      { id: "g2", year: 2032, amount: 1_000_000, grantor: "client", recipientFamilyMemberId: "fm-1" } as Gift,
      { id: "g3", year: 2032, amount: 1_000_000, grantor: "client", recipientExternalBeneficiaryId: "eb-1" } as Gift,
    ];
    const map = deriveRecipientBreaches({ ledger: [breachYear], gifts, giftEvents: [] });
    expect(map.get("entity:trust-1")).toBe(true);
    expect(map.get("family:fm-1")).toBe(true);
    expect(map.get("external:eb-1")).toBe(true);
  });
});
