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

// ── Valuation discounts ──────────────────────────────────────────────────────

const trust3 = (over: Partial<EntitySummary> = {}): EntitySummary =>
  ({
    id: "t3", name: "Crummey ILIT", entityType: "trust", isIrrevocable: true,
    crummeyPowers: true, includeInPortfolio: false, isGrantor: false,
    beneficiaries: [
      { id: "b1", tier: "primary", percentage: 34, familyMemberId: "k1", sortOrder: 0 },
      { id: "b2", tier: "primary", percentage: 33, familyMemberId: "k2", sortOrder: 1 },
      { id: "b3", tier: "primary", percentage: 33, familyMemberId: "k3", sortOrder: 2 },
    ],
    ...over,
  }) as EntitySummary;

const nonCrummeyTrust = (over: Partial<EntitySummary> = {}): EntitySummary =>
  ({
    id: "t-nc", name: "Dynasty Trust", entityType: "trust", isIrrevocable: true,
    crummeyPowers: false, includeInPortfolio: false, isGrantor: false,
    beneficiaries: [],
    ...over,
  }) as EntitySummary;

describe("toCanonicalGifts — valuation discount ordering", () => {
  it("applies the discount BEFORE the annual exclusion (the pinning assertion)", () => {
    // $100,000 outright to a family member at a 40% discount, $19,000 exclusion.
    // Correct:   (100,000 × 0.6) − 19,000 = 41,000 lifetime used.
    // WRONG:     (100,000 − 19,000) × 0.6 = 48,600.
    const gifts: Gift[] = [
      { id: "g1", year: 2030, amount: 100_000, grantor: "client",
        recipientFamilyMemberId: "k1", useCrummeyPowers: false,
        valuationDiscount: 0.4 },
    ];
    const [cg] = toCanonicalGifts(gifts, [], ctx());
    expect(cg.amount).toBe(60_000);
    expect(cg.undiscountedAmount).toBe(100_000);
    expect(cg.valuationDiscount).toBe(0.4);

    const t = treatCanonicalGift(cg, 19_000);
    expect(t.annualExcluded).toBe(19_000);
    expect(t.lifetimeUsed).toBe(41_000);
    expect(t.lifetimeUsed).not.toBe(48_600);
  });

  it("Crummey trust with 3 beneficiaries: exclusion caps against the DISCOUNTED amount", () => {
    const gifts: Gift[] = [
      { id: "g2", year: 2030, amount: 100_000, grantor: "client",
        recipientEntityId: "t3", useCrummeyPowers: true, valuationDiscount: 0.3 },
    ];
    const [cg] = toCanonicalGifts(gifts, [], ctx([trust3()]));
    expect(cg.amount).toBe(70_000);
    const t = treatCanonicalGift(cg, 19_000);
    // min(70,000, 19,000 × 3) = 57,000
    expect(t.annualExcluded).toBe(57_000);
    expect(t.lifetimeUsed).toBe(13_000);
  });

  it("non-Crummey irrevocable trust: the whole discounted value consumes exemption", () => {
    const gifts: Gift[] = [
      { id: "g3", year: 2030, amount: 1_000_000, grantor: "client",
        recipientEntityId: "t-nc", useCrummeyPowers: false, valuationDiscount: 0.3 },
    ];
    const [cg] = toCanonicalGifts(gifts, [], ctx([nonCrummeyTrust()]));
    const t = treatCanonicalGift(cg, 19_000);
    expect(t.lifetimeUsed).toBe(700_000);
    expect(t.annualExcluded).toBe(0);
    expect(cg.undiscountedAmount).toBe(1_000_000);
  });

  it("charitable gift: the charitable exclusion is the DISCOUNTED value", () => {
    const gifts: Gift[] = [
      { id: "g4", year: 2030, amount: 1_000_000, grantor: "client",
        recipientExternalBeneficiaryId: "charity1", useCrummeyPowers: false,
        valuationDiscount: 0.3 },
    ];
    const [cg] = toCanonicalGifts(gifts, [], ctx());
    const t = treatCanonicalGift(cg, 19_000);
    expect(t.charitableExcluded).toBe(700_000);
    expect(t.lifetimeUsed).toBe(0);
  });
});

describe("toCanonicalGifts — undiscountedAmount on all four push sites", () => {
  it("legacy cash gifts[]", () => {
    const [cg] = toCanonicalGifts(
      [{ id: "g", year: 2030, amount: 500_000, grantor: "client",
         recipientEntityId: "t-nc", useCrummeyPowers: false, valuationDiscount: 0.2 }],
      [], ctx([nonCrummeyTrust()]),
    );
    expect(cg).toMatchObject({ amount: 400_000, undiscountedAmount: 500_000, valuationDiscount: 0.2 });
  });

  it("series fan-out cash events", () => {
    const [cg] = toCanonicalGifts([], [
      { kind: "cash", year: 2030, amount: 200_000, grantor: "client",
        recipientEntityId: "t-nc", useCrummeyPowers: false, seriesId: "s1",
        valuationDiscount: 0.25 },
    ], ctx([nonCrummeyTrust()]));
    expect(cg).toMatchObject({ amount: 150_000, undiscountedAmount: 200_000, valuationDiscount: 0.25 });
  });

  it("asset (account-percentage) events — discount applies to value × percent", () => {
    const [cg] = toCanonicalGifts([], [
      { kind: "asset", year: 2030, accountId: "a1", percent: 0.25, grantor: "client",
        recipientEntityId: "t-nc", valuationDiscount: 0.3 },
    ], { ...ctx([nonCrummeyTrust()]), accountValueAtYear: () => 400_000 });
    expect(cg).toMatchObject({ amount: 70_000, undiscountedAmount: 100_000, valuationDiscount: 0.3 });
  });

  it("business-interest events — discount applies to the amountOverride full value", () => {
    const [cg] = toCanonicalGifts([], [
      { kind: "business_interest", year: 2030, entityId: "biz1", percent: 0.3,
        grantor: "client", recipientEntityId: "t-nc", amountOverride: 1_000_000,
        valuationDiscount: 0.35 },
    ], ctx([nonCrummeyTrust()]));
    expect(cg).toMatchObject({ amount: 650_000, undiscountedAmount: 1_000_000, valuationDiscount: 0.35 });
  });
});

describe("toCanonicalGifts — discount edge cases", () => {
  it("an explicit 0 produces output identical to an absent discount", () => {
    const mk = (d: number | undefined): Gift[] => [
      { id: "g", year: 2030, amount: 100_000, grantor: "client",
        recipientEntityId: "t-nc", useCrummeyPowers: false, valuationDiscount: d },
    ];
    const withZero = toCanonicalGifts(mk(0), [], ctx([nonCrummeyTrust()]));
    const withNone = toCanonicalGifts(mk(undefined), [], ctx([nonCrummeyTrust()]));
    expect(JSON.stringify(withZero)).toBe(JSON.stringify(withNone));
  });

  it("a joint gift halves both the discounted amount and the full value", () => {
    const out = toCanonicalGifts(
      [{ id: "g", year: 2030, amount: 1_000_000, grantor: "joint",
         recipientEntityId: "t-nc", useCrummeyPowers: false, valuationDiscount: 0.3 }],
      [], ctx([nonCrummeyTrust()]),
    );
    expect(out).toHaveLength(2);
    expect(out.map((c) => [c.grantor, c.amount, c.undiscountedAmount])).toEqual([
      ["client", 350_000, 500_000],
      ["spouse", 350_000, 500_000],
    ]);
  });

  it("clamps a corrupt out-of-range discount to a $0 gift, never a negative one", () => {
    const [cg] = toCanonicalGifts(
      [{ id: "g", year: 2030, amount: 100_000, grantor: "client",
         recipientEntityId: "t-nc", useCrummeyPowers: false, valuationDiscount: 1.5 }],
      [], ctx([nonCrummeyTrust()]),
    );
    expect(cg.amount).toBe(0);
    expect(cg.valuationDiscount).toBe(1);
  });

  it("liability events still contribute nothing and gain no discount", () => {
    const out = toCanonicalGifts([], [
      { kind: "liability", year: 2030, liabilityId: "l1", percent: 0.5,
        grantor: "client", recipientEntityId: "t-nc", parentGiftId: "g1" },
    ], ctx([nonCrummeyTrust()]));
    expect(out).toEqual([]);
  });
});

describe("FLP path end to end — the route's row shape reaches the right exemption", () => {
  it("a business-interest row with a full-value amount and a 35% discount consumes 65%", () => {
    // Exactly what entities/[entityId]/assets/route.ts writes: amount =
    // businessValue × lostPct (full), percent = lostPct, discount = advisor's.
    const [cg] = toCanonicalGifts([], [
      { kind: "business_interest", year: 2030, entityId: "biz-1", percent: 0.3,
        grantor: "client", recipientEntityId: "t-nc", amountOverride: 300_000,
        valuationDiscount: 0.35 },
    ], ctx([nonCrummeyTrust()]));
    expect(cg.undiscountedAmount).toBe(300_000);
    expect(cg.amount).toBe(195_000);
    expect(treatCanonicalGift(cg, 19_000).lifetimeUsed).toBe(195_000);
  });
});
