import { describe, it, expect } from "vitest";
import { toCanonicalGifts, treatCanonicalGift } from "../normalize-gifts";
import type { Gift, GiftEvent, EntitySummary } from "@/engine/types";

const trust = (over: Partial<EntitySummary>): EntitySummary =>
  ({
    id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true,
    crummeyPowers: true, includeInPortfolio: false, isGrantor: false,
    beneficiaries: [
      { id: "b1", tier: "primary", percentage: 50, familyMemberId: "k1", sortOrder: 0 },
      { id: "b2", tier: "primary", percentage: 50, familyMemberId: "k2", sortOrder: 1 },
    ],
    ...over,
  }) as EntitySummary;

const ctx = (entities: EntitySummary[] = [trust({})]) => ({
  entities,
  externalBeneficiaries: [{ id: "charity1", kind: "charity" as const }],
  accountValueAtYear: () => 0,
});

describe("toCanonicalGifts — dedup invariant", () => {
  it("includes a one-time cash gift once (from gifts[]), skipping its giftEvents mirror", () => {
    const gifts: Gift[] = [
      { id: "g1", year: 2030, amount: 20_000, grantor: "client", recipientFamilyMemberId: "k1", useCrummeyPowers: false },
    ];
    const events: GiftEvent[] = [
      { kind: "cash", year: 2030, amount: 20_000, grantor: "client", useCrummeyPowers: false },
    ];
    const out = toCanonicalGifts(gifts, events, ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 20_000, grantor: "client", recipientFamilyMemberId: "k1" });
  });

  it("includes a premium giftEvent (sourcePolicyAccountId) and a series giftEvent (seriesId)", () => {
    const events: GiftEvent[] = [
      { kind: "cash", year: 2030, amount: 10_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", sourcePolicyAccountId: "pol1" },
      { kind: "cash", year: 2030, amount: 5_000, grantor: "client", useCrummeyPowers: false, seriesId: "s1" },
    ];
    const out = toCanonicalGifts([], events, ctx());
    expect(out).toHaveLength(2);
  });
});

describe("toCanonicalGifts — joint split (§2513)", () => {
  it("splits a joint gift into two half-gifts", () => {
    const gifts: Gift[] = [
      { id: "g1", year: 2030, amount: 40_000, grantor: "joint", recipientFamilyMemberId: "k1", useCrummeyPowers: false },
    ];
    const out = toCanonicalGifts(gifts, [], ctx());
    expect(out.map((c) => [c.grantor, c.amount])).toEqual([
      ["client", 20_000],
      ["spouse", 20_000],
    ]);
  });
});

describe("treatCanonicalGift", () => {
  it("Crummey trust gift: annual exclusion × beneficiary count", () => {
    const [cg] = toCanonicalGifts(
      [], [{ kind: "cash", year: 2030, amount: 40_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", sourcePolicyAccountId: "p1" }],
      ctx(),
    );
    expect(treatCanonicalGift(cg, 18_000)).toEqual({ lifetimeUsed: 4_000, annualExcluded: 36_000, charitableExcluded: 0 });
  });

  it("non-Crummey trust gift: full lifetime use", () => {
    const [cg] = toCanonicalGifts(
      [], [{ kind: "cash", year: 2030, amount: 40_000, grantor: "client", useCrummeyPowers: false, recipientEntityId: "t1", seriesId: "s1" }],
      ctx([trust({ crummeyPowers: false })]),
    );
    expect(treatCanonicalGift(cg, 18_000)).toEqual({ lifetimeUsed: 40_000, annualExcluded: 0, charitableExcluded: 0 });
  });

  it("recipient-less premium gift (individual-owned): single exclusion", () => {
    const [cg] = toCanonicalGifts(
      [], [{ kind: "cash", year: 2030, amount: 30_000, grantor: "client", useCrummeyPowers: false, sourcePolicyAccountId: "p1" }],
      ctx(),
    );
    expect(treatCanonicalGift(cg, 18_000)).toEqual({ lifetimeUsed: 12_000, annualExcluded: 18_000, charitableExcluded: 0 });
  });

  it("asset gift to trust: full lifetime use (Crummey is cash-only)", () => {
    const events: GiftEvent[] = [
      { kind: "asset", year: 2030, accountId: "a1", percent: 1, grantor: "client", recipientEntityId: "t1", amountOverride: 100_000 },
    ];
    const [cg] = toCanonicalGifts([], events, ctx());
    expect(cg.useCrummeyPowers).toBe(false);
    expect(treatCanonicalGift(cg, 18_000)).toEqual({ lifetimeUsed: 100_000, annualExcluded: 0, charitableExcluded: 0 });
  });
});
