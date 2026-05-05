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

  it("does not double-count a cash gift to a grantor trust", () => {
    // Loader path: a $50K cash gift to a grantor-client trust appears in BOTH
    // `gifts` (legacy array) AND in `entity.exemptionConsumed` (loader sums
    // gifts.amount per recipientEntityId). The engine must not stack them.
    // Expected: $50K − $19K exclusion = $31K, NOT $81K (and NOT $100K).
    const gifts = [gift({ year: 2026, amount: 50_000, grantor: "client", recipientEntityId: "trust-1" })];
    const entities = [entity({ id: "trust-1", grantor: "client", exemptionConsumed: 50_000 })];
    expect(computeAdjustedTaxableGifts("client", gifts, entities, ann, noAccountValue)).toBeCloseTo(31_000, 2);
  });

  it("ignores entity.exemptionConsumed (loader-derived display value, not an estate-tax input)", () => {
    // Post-186a97a: `exemption_consumed` was dropped as an advisor-entered
    // column. The loader derives it from the gifts ledger for trust-card UI.
    // It must not feed back into computeAdjustedTaxableGifts or it would
    // double-count gifts already in the `gifts`/`giftEvents` arrays.
    const entities = [entity({ grantor: "client", exemptionConsumed: 2_400_000 })];
    expect(computeAdjustedTaxableGifts("client", [], entities, ann, noAccountValue)).toBe(0);
    expect(computeAdjustedTaxableGifts("spouse", [], entities, ann, noAccountValue)).toBe(0);
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

  it("skips one-time cash giftEvents (no seriesId) — they come from the legacy gifts array", () => {
    // One-time cash gift with no seriesId should be skipped in the giftEvents path
    // to avoid double-counting (it would also appear in the legacy gifts array).
    const giftEvents: GiftEvent[] = [
      {
        kind: "cash",
        year: 2028,
        amount: 19_000,
        grantor: "client",
        recipientEntityId: "trust-1",
        useCrummeyPowers: false,
        // seriesId is absent — one-time cash gift
      },
    ];
    expect(computeAdjustedTaxableGifts("client", [], [], ann, noAccountValue, giftEvents)).toBe(0);
  });

  it("counts series-fanned cash events from giftEvents (with seriesId) but not duplicate legacy gifts", () => {
    // $19K series cash gift at 2028 — annual exclusion not in ann for 2028, so no subtraction.
    const giftEvents: GiftEvent[] = [
      {
        kind: "cash",
        year: 2028,
        amount: 19_000,
        grantor: "client",
        recipientEntityId: "trust-1",
        useCrummeyPowers: false,
        seriesId: "gs1",
      },
    ];
    // Annual exclusion = not set for 2028 (defaults to 0), gift = $19K, so consumed = $19K.
    expect(computeAdjustedTaxableGifts("client", [], [], ann, noAccountValue, giftEvents)).toBeCloseTo(19_000, 2);
  });

  it("does not double-count one-time cash gifts when both legacy gifts AND giftEvents are populated", () => {
    // Simulates the loader path: same cash row appears in both arrays.
    const result = computeAdjustedTaxableGifts(
      "client",
      [{ id: "g1", year: 2028, amount: 100_000, grantor: "client", recipientEntityId: "trust-1", useCrummeyPowers: false }],
      [],
      { 2028: 19_000 },
      () => 0,
      [{ kind: "cash", year: 2028, amount: 100_000, grantor: "client", recipientEntityId: "trust-1", useCrummeyPowers: false }], // duplicate of the legacy row, no seriesId
    );
    // Expect $81K (100K - 19K exclusion), not $162K.
    expect(result).toBe(81_000);
  });

  it("uses the gift-year balance, not the death-year balance, for asset transfers", () => {
    // Account: $1M at year 2030, $4M at year 2055 (death year).
    // Gift in 2030: 50% transferred. Should contribute $500K, NOT $2M.
    const accountValueAtYear = (id: string, year: number): number => {
      if (id !== "acct-1") return 0;
      return year === 2030 ? 1_000_000 : year === 2055 ? 4_000_000 : 0;
    };
    const result = computeAdjustedTaxableGifts(
      "client",
      [],
      [],
      {},
      accountValueAtYear,
      [{ kind: "asset", year: 2030, accountId: "acct-1", percent: 0.5, grantor: "client", recipientEntityId: "trust-1" }],
    );
    expect(result).toBe(500_000); // not 2_000_000
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
