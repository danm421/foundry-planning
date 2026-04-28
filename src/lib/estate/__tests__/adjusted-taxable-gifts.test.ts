import { describe, it, expect } from "vitest";
import { computeAdjustedTaxableGifts } from "../adjusted-taxable-gifts";
import type { Gift, EntitySummary, GiftEvent } from "@/engine/types";

const ann = { 2025: 19_000, 2026: 19_000, 2027: 19_500 };

function gift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: "g1",
    year: 2025,
    amount: 100_000,
    grantor: "client",
    useCrummeyPowers: false,
    ...overrides,
  };
}

function entity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: "e1",
    includeInPortfolio: true,
    isGrantor: true,
    exemptionConsumed: 0,
    ...overrides,
  };
}

const noAccountValue = (_id: string, _year: number) => 0;

describe("computeAdjustedTaxableGifts", () => {
  it("returns 0 when decedent has no gifts and no grantor-trusts", () => {
    expect(computeAdjustedTaxableGifts("client", [], [], ann, noAccountValue)).toBe(0);
  });

  it("subtracts the annual exclusion per gift, floored at zero", () => {
    const gifts = [
      gift({ year: 2025, amount: 100_000 }),
      gift({ year: 2025, amount: 15_000 }),
      gift({ year: 2027, amount: 30_000 }),
    ];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann, noAccountValue)).toBeCloseTo(81_000 + 10_500, 2);
  });

  it("excludes spouse-grantor gifts when decedent is client", () => {
    const gifts = [
      gift({ grantor: "client", amount: 100_000 }),
      gift({ grantor: "spouse", amount: 100_000 }),
    ];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann, noAccountValue)).toBeCloseTo(81_000, 2);
  });

  it("splits joint gifts 50/50", () => {
    const gifts = [gift({ grantor: "joint", amount: 100_000 })];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann, noAccountValue)).toBeCloseTo(31_000, 2);
    expect(computeAdjustedTaxableGifts("spouse", gifts, [], ann, noAccountValue)).toBeCloseTo(31_000, 2);
  });

  it("adds trust exemptionConsumed when entity.grantor === decedent", () => {
    const entities = [entity({ grantor: "client", exemptionConsumed: 2_400_000 })];
    expect(computeAdjustedTaxableGifts("client", [], entities, ann, noAccountValue)).toBeCloseTo(2_400_000, 2);
    expect(computeAdjustedTaxableGifts("spouse", [], entities, ann, noAccountValue)).toBe(0);
  });

  it("third-party-grantor trust (entity.grantor === undefined) contributes 0", () => {
    const entities = [entity({ grantor: undefined, exemptionConsumed: 2_400_000 })];
    expect(computeAdjustedTaxableGifts("client", [], entities, ann, noAccountValue)).toBe(0);
  });

  it("combined: gifts + trust exemption stacks for the same grantor", () => {
    const gifts = [gift({ year: 2025, amount: 100_000, grantor: "client" })];
    const entities = [entity({ grantor: "client", exemptionConsumed: 1_000_000 })];
    expect(computeAdjustedTaxableGifts("client", gifts, entities, ann, noAccountValue)).toBeCloseTo(81_000 + 1_000_000, 2);
  });

  it("missing annual exclusion for a year defaults to 0 (no subtraction)", () => {
    const gifts = [gift({ year: 2099, amount: 50_000 })];
    expect(computeAdjustedTaxableGifts("client", gifts, [], ann, noAccountValue)).toBeCloseTo(50_000, 2);
  });
});

describe("computeAdjustedTaxableGifts (Phase 3 — asset/liability giftEvents)", () => {
  it("includes asset-transfer event values (engine-computed × percent)", () => {
    // 50% transfer at 2030, account value at 2030 = $1,200,000 — no override.
    // Expect: $600,000 contribution (minus $0 annual exclusion, not applicable here).
    const giftEvents: GiftEvent[] = [
      {
        kind: "asset",
        year: 2030,
        accountId: "acct-1",
        percent: 0.5,
        grantor: "client",
        recipientEntityId: "trust-1",
      },
    ];
    const accountValueAtYear = (id: string, _year: number) => (id === "acct-1" ? 1_200_000 : 0);
    expect(computeAdjustedTaxableGifts("client", [], [], ann, accountValueAtYear, giftEvents)).toBeCloseTo(600_000, 2);
  });

  it("respects amountOverride when set on an asset transfer", () => {
    // Same scenario with advisor override = $400,000.
    const giftEvents: GiftEvent[] = [
      {
        kind: "asset",
        year: 2030,
        accountId: "acct-1",
        percent: 0.5,
        grantor: "client",
        recipientEntityId: "trust-1",
        amountOverride: 400_000,
      },
    ];
    const accountValueAtYear = (id: string, _year: number) => (id === "acct-1" ? 1_200_000 : 0);
    expect(computeAdjustedTaxableGifts("client", [], [], ann, accountValueAtYear, giftEvents)).toBeCloseTo(400_000, 2);
  });

  it("excludes liability-only gifts (debt assumption is not a gift of value)", () => {
    const giftEvents: GiftEvent[] = [
      {
        kind: "liability",
        year: 2030,
        liabilityId: "liab-1",
        percent: 1.0,
        grantor: "client",
        recipientEntityId: "trust-1",
        parentGiftId: "gift-parent-1",
      },
    ];
    expect(computeAdjustedTaxableGifts("client", [], [], ann, noAccountValue, giftEvents)).toBe(0);
  });

  it("includes cash giftEvents unchanged (legacy cash-gift path still works)", () => {
    // $19K cash gift at 2028 — annual exclusion for 2028 is not in `ann`, so no subtraction.
    const giftEvents: GiftEvent[] = [
      {
        kind: "cash",
        year: 2028,
        amount: 19_000,
        grantor: "client",
        recipientEntityId: "trust-1",
        useCrummeyPowers: false,
      },
    ];
    expect(computeAdjustedTaxableGifts("client", [], [], ann, noAccountValue, giftEvents)).toBeCloseTo(19_000, 2);
  });

  it("excludes asset giftEvents from a different grantor", () => {
    const giftEvents: GiftEvent[] = [
      {
        kind: "asset",
        year: 2030,
        accountId: "acct-1",
        percent: 1.0,
        grantor: "spouse",
        recipientEntityId: "trust-1",
      },
    ];
    const accountValueAtYear = (id: string, _year: number) => (id === "acct-1" ? 1_000_000 : 0);
    expect(computeAdjustedTaxableGifts("client", [], [], ann, accountValueAtYear, giftEvents)).toBe(0);
    expect(computeAdjustedTaxableGifts("spouse", [], [], ann, accountValueAtYear, giftEvents)).toBeCloseTo(1_000_000, 2);
  });
});
