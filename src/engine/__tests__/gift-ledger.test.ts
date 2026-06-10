import { describe, it, expect } from "vitest";
import { computeGiftLedger } from "../gift-ledger";
import type { EntitySummary, Gift, GiftEvent } from "../types";

const noAccountValue = () => 0;

// Irrevocable trust "trust-1" — the recipient for all asset/business GiftEvents
// below. No Crummey beneficiaries: asset/business transfers are cash-only for
// Crummey purposes, so every gift to it consumes full lifetime exemption.
const trustT1 = {
  id: "trust-1",
  name: "Dynasty Trust",
  entityType: "trust",
  isIrrevocable: true,
  crummeyPowers: false,
  beneficiaries: [],
} as unknown as EntitySummary;

const baseInput = {
  planStartYear: 2026,
  planEndYear: 2030,
  hasSpouse: true,
  priorTaxableGifts: { client: 0, spouse: 0 },
  gifts: [] as Gift[],
  giftEvents: [] as GiftEvent[],
  entities: [],
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
      externalBeneficiaries: [{ id: "ext-charity-1", kind: "charity" }],
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(0);
    expect(ledger[0].taxableGiftsGiven).toBe(0);
  });

  function assetEvent(over: Record<string, unknown> = {}): GiftEvent {
    return {
      id: "ge1",
      kind: "asset",
      year: 2026,
      grantor: "client",
      accountId: "acct-1",
      percent: 1,
      amountOverride: undefined,
      recipientEntityId: "trust-1",
      recipientFamilyMemberId: undefined,
      recipientExternalBeneficiaryId: undefined,
      seriesId: undefined,
      ...over,
    } as unknown as GiftEvent;
  }

  it("adds asset GiftEvent's gift-year value (no AE on asset transfers)", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [trustT1],
      giftEvents: [assetEvent({ year: 2026, accountId: "acct-1", percent: 0.5 })],
      accountValueAtYear: (id, year) => (id === "acct-1" && year === 2026 ? 600_000 : 0),
    });
    // 0.5 * 600_000 = 300_000, full amount counts (no AE on asset)
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBeCloseTo(300_000, 2);
  });

  it("uses amountOverride for asset GiftEvent when set", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [trustT1],
      giftEvents: [assetEvent({ year: 2026, amountOverride: 250_000, percent: 1 })],
      // Override should win even though accountValueAtYear would return a different number.
      accountValueAtYear: () => 999_999,
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(250_000);
  });

  it("asset GiftEvent to a Crummey trust still consumes full lifetime (Crummey is cash-only)", () => {
    // Asset transfers never qualify for the annual exclusion even when the
    // receiving trust has Crummey beneficiaries — withdrawal powers only apply
    // to contributed cash. So a $400k asset gift is taxable in full.
    const crummeyTrust = {
      id: "trust-1",
      name: "ILIT",
      entityType: "trust",
      isIrrevocable: true,
      crummeyPowers: true,
      beneficiaries: [
        { id: "b1", tier: "primary", percentage: 100, familyMemberId: "k1", sortOrder: 0 },
      ],
    } as unknown as EntitySummary;
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [crummeyTrust],
      giftEvents: [assetEvent({ year: 2026, amountOverride: 400_000 })],
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(400_000);
  });

  it("processes series-fanned cash GiftEvents (seriesId set) with AE", () => {
    // Series cash always targets a trust. A 1-beneficiary Crummey trust earns
    // exactly one annual exclusion. Crummey: 1 ben × $19k (2026) → 50k − 19k.
    const seriesTrust = {
      id: "t-series",
      name: "ILIT",
      entityType: "trust",
      isIrrevocable: true,
      crummeyPowers: true,
      beneficiaries: [
        { id: "b1", tier: "primary", percentage: 100, familyMemberId: "k1", sortOrder: 0 },
      ],
    } as unknown as EntitySummary;
    const cashSeries: GiftEvent = {
      kind: "cash",
      year: 2026,
      grantor: "client",
      amount: 50_000,
      seriesId: "series-1",
      useCrummeyPowers: true,
      recipientEntityId: "t-series",
    };
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [seriesTrust],
      giftEvents: [cashSeries],
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBeCloseTo(31_000, 2);
  });

  it("ignores one-time cash GiftEvents (no seriesId — handled via legacy gifts[])", () => {
    const oneTime: GiftEvent = {
      kind: "cash",
      year: 2026,
      grantor: "client",
      amount: 50_000,
      useCrummeyPowers: false,
    };
    const ledger = computeGiftLedger({ ...baseInput, giftEvents: [oneTime] });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(0);
  });

  it("liability GiftEvents contribute 0 (debt assumption is not a gift of value)", () => {
    const liabEvent: GiftEvent = {
      id: "ge4",
      kind: "liability",
      year: 2026,
      grantor: "client",
      liabilityId: "liab-1",
      percent: 1,
      recipientEntityId: "trust-1",
    } as unknown as GiftEvent;
    const ledger = computeGiftLedger({ ...baseInput, giftEvents: [liabEvent] });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(0);
  });

  it("business_interest GiftEvent at 100% of a $1M LLC → $1M cumulative taxable (no AE)", () => {
    const businessGift: GiftEvent = {
      id: "ge-biz-1",
      kind: "business_interest",
      year: 2026,
      grantor: "client",
      entityId: "biz-llc-1",
      percent: 1,
      recipientEntityId: "trust-1",
      amountOverride: undefined,
    } as unknown as GiftEvent;
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [trustT1],
      giftEvents: [businessGift],
      entityValueAtYear: (id, year) => (id === "biz-llc-1" && year === 2026 ? 1_000_000 : 0),
    });
    // No annual exclusion applies — Crummey is cash-only.
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(1_000_000);
    expect(ledger[0].perGrantor.client.cumulativeTaxableGifts).toBe(1_000_000);
    expect(ledger[0].taxableGiftsGiven).toBe(1_000_000);
    // Gross gifts also reflect the full $1M.
    expect(ledger[0].giftsGiven).toBe(1_000_000);
  });

  it("business_interest GiftEvent uses amountOverride when set", () => {
    const businessGift: GiftEvent = {
      id: "ge-biz-2",
      kind: "business_interest",
      year: 2026,
      grantor: "client",
      entityId: "biz-llc-1",
      percent: 0.25,
      recipientEntityId: "trust-1",
      amountOverride: 750_000,
    } as unknown as GiftEvent;
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [trustT1],
      giftEvents: [businessGift],
      // Override should win even though percent × value would yield a different number.
      entityValueAtYear: () => 9_999_999,
    });
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(750_000);
  });

  it("business_interest GiftEvent at fractional percent uses entityValueAtYear × percent", () => {
    const businessGift: GiftEvent = {
      id: "ge-biz-3",
      kind: "business_interest",
      year: 2026,
      grantor: "client",
      entityId: "biz-llc-1",
      percent: 0.4,
      recipientEntityId: "trust-1",
      amountOverride: undefined,
    } as unknown as GiftEvent;
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [trustT1],
      giftEvents: [businessGift],
      entityValueAtYear: (id, year) => (id === "biz-llc-1" && year === 2026 ? 2_500_000 : 0),
    });
    // 0.4 × 2_500_000 = 1_000_000
    expect(ledger[0].perGrantor.client.taxableGiftsThisYear).toBe(1_000_000);
  });

  it("populates giftsGiven (gross) regardless of grantor or charitable status", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      gifts: [
        gift({ year: 2026, amount: 100_000, grantor: "client" }),
        gift({
          id: "g2",
          year: 2026,
          amount: 500_000,
          grantor: "client",
          recipientFamilyMemberId: undefined,
          recipientExternalBeneficiaryId: "ext-charity-1",
        }),
      ],
      externalBeneficiaries: [{ id: "ext-charity-1", kind: "charity" }],
    });
    // Gross sums everything: 100k + 500k = 600k
    expect(ledger[0].giftsGiven).toBeCloseTo(600_000, 2);
    // Taxable nets out: 100k − 19k AE = 81k; charity = 0
    expect(ledger[0].taxableGiftsGiven).toBeCloseTo(81_000, 2);
  });

  it("omits perGrantor.spouse for single-filer (hasSpouse: false)", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      hasSpouse: false,
      priorTaxableGifts: { client: 500_000, spouse: 0 },
    });
    expect(ledger[0].perGrantor.spouse).toBeUndefined();
    expect(ledger[0].perGrantor.client.cumulativeTaxableGifts).toBe(500_000);
  });

  it("BEA overflow generates current-year gift tax via §2502 marginal calc", () => {
    // Force overflow: $20M prior taxable gifts in plan-year 2026 with BEA = $15M
    const ledger = computeGiftLedger({
      ...baseInput,
      planStartYear: 2026,
      planEndYear: 2026,
      priorTaxableGifts: { client: 20_000_000, spouse: 0 },
    });
    // No new gifts → giftTaxThisYear = 0 (overflow happened pre-plan; no current-year delta)
    expect(ledger[0].perGrantor.client.giftTaxThisYear).toBe(0);
  });

  it("BEA overflow during plan year generates positive giftTaxThisYear", () => {
    // 2026 BEA = $15M. Client makes $16M cash gift in 2026 → $1M over BEA.
    const ledger = computeGiftLedger({
      ...baseInput,
      planStartYear: 2026,
      planEndYear: 2026,
      priorTaxableGifts: { client: 0, spouse: 0 },
      gifts: [gift({ year: 2026, amount: 16_000_000, grantor: "client" })],
    });
    expect(ledger[0].perGrantor.client.giftTaxThisYear).toBeGreaterThan(0);
    // Marginal $981k over BEA at 40% top bracket ≈ 392_400
    expect(ledger[0].perGrantor.client.giftTaxThisYear).toBeCloseTo(392_400, -2);
    expect(ledger[0].totalGiftTax).toBe(ledger[0].perGrantor.client.giftTaxThisYear);
  });

  it("accumulates cumulativeGiftTax across plan years", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      planStartYear: 2026,
      planEndYear: 2028,
      priorTaxableGifts: { client: 14_000_000, spouse: 0 }, // close to BEA
      gifts: [
        gift({ id: "ga", year: 2026, amount: 2_000_000, grantor: "client" }),
        gift({ id: "gb", year: 2028, amount: 1_000_000, grantor: "client" }),
      ],
    });
    // Year 2026: cumulative crosses BEA → some giftTax
    expect(ledger[0].perGrantor.client.giftTaxThisYear).toBeGreaterThan(0);
    // Year 2028: another gift — additional giftTax
    expect(ledger[2].perGrantor.client.giftTaxThisYear).toBeGreaterThan(0);
    // Cumulative grows
    expect(ledger[2].perGrantor.client.cumulativeGiftTax).toBeGreaterThan(
      ledger[0].perGrantor.client.cumulativeGiftTax,
    );
  });
});

describe("computeGiftLedger — unified Crummey model", () => {
  const trust = {
    id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true, crummeyPowers: true,
    includeInPortfolio: false, isGrantor: false,
    beneficiaries: [
      { id: "b1", tier: "primary", percentage: 50, familyMemberId: "k1", sortOrder: 0 },
      { id: "b2", tier: "primary", percentage: 50, familyMemberId: "k2", sortOrder: 1 },
    ],
  } as unknown as import("@/engine/types").EntitySummary;

  it("premium gift to a 2-beneficiary Crummey trust: taxable = amount − 2×exclusion; appears in gross", () => {
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [trust],
      annualExclusionsByYear: { 2030: 18_000 },
      giftEvents: [
        { kind: "cash", year: 2030, amount: 50_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", sourcePolicyAccountId: "pol1" },
      ],
    });
    const row = ledger.find((r) => r.year === 2030)!;
    expect(row.giftsGiven).toBe(50_000);                       // gross now visible
    expect(row.perGrantor.client.taxableGiftsThisYear).toBe(14_000); // 50k − 36k
  });
});

describe("computeGiftLedger — §2503(b) one exclusion per donee per year (BUG #8)", () => {
  // 1-beneficiary Crummey trust: shares ONE annual exclusion (AE × 1) across all
  // Crummey-eligible cash reaching it in a year, regardless of how many distinct
  // gift events route there.
  const ilit1Ben = {
    id: "t1",
    name: "ILIT",
    entityType: "trust",
    isIrrevocable: true,
    crummeyPowers: true,
    beneficiaries: [
      { id: "b1", tier: "primary", percentage: 100, familyMemberId: "k1", sortOrder: 0 },
    ],
  } as unknown as import("@/engine/types").EntitySummary;

  it("two cash gifts to the same 1-ben Crummey trust in one year share ONE exclusion", () => {
    // A premium gift (sourcePolicyAccountId) + a series gift (seriesId), both
    // $19k, both Crummey, both to t1 in 2026. Total $38k − ONE $19k exclusion
    // = $19k taxable. BEFORE FIX each gift claimed its own $19k exclusion → $0.
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [ilit1Ben],
      annualExclusionsByYear: { 2026: 19_000 },
      giftEvents: [
        { kind: "cash", year: 2026, amount: 19_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", sourcePolicyAccountId: "pol1" },
        { kind: "cash", year: 2026, amount: 19_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", seriesId: "series-1" },
      ],
    });
    const row = ledger.find((r) => r.year === 2026)!;
    expect(row.giftsGiven).toBe(38_000);
    expect(row.perGrantor.client.taxableGiftsThisYear).toBe(19_000);
  });

  it("GUARD: a single normal gift to a donee still gets exactly one full exclusion", () => {
    // No regression: one $50k Crummey cash gift to the 1-ben trust →
    // 50k − 19k = 31k taxable (unchanged from the per-gift path).
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [ilit1Ben],
      annualExclusionsByYear: { 2026: 19_000 },
      giftEvents: [
        { kind: "cash", year: 2026, amount: 50_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", seriesId: "series-1" },
      ],
    });
    const row = ledger.find((r) => r.year === 2026)!;
    expect(row.perGrantor.client.taxableGiftsThisYear).toBe(31_000);
  });

  it("mixed group: Crummey cash + asset to the SAME ILIT do not pool the cash exclusion", () => {
    // $19k Crummey cash (AE-eligible) + $200k asset transfer (no-AE,
    // useCrummeyPowers forced false) to the same trust in one year.
    // Cash nets to 0 against its single $19k exclusion; the asset stays fully
    // taxable. Total taxable = 0 + 200_000 = 200_000 (NOT 200_000 − 19_000).
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [ilit1Ben],
      annualExclusionsByYear: { 2026: 19_000 },
      giftEvents: [
        { kind: "cash", year: 2026, amount: 19_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", seriesId: "series-1" },
        { kind: "asset", year: 2026, grantor: "client", accountId: "acct-1", percent: 1, amountOverride: 200_000, recipientEntityId: "t1" } as unknown as GiftEvent,
      ],
    });
    const row = ledger.find((r) => r.year === 2026)!;
    expect(row.perGrantor.client.taxableGiftsThisYear).toBe(200_000);
  });

  it("two gifts to DIFFERENT donees each keep their own full exclusion", () => {
    // A $19k Crummey cash to t1 and a $19k cash to a family member: distinct
    // donees → two separate exclusions → both net to 0.
    const ledger = computeGiftLedger({
      ...baseInput,
      entities: [ilit1Ben],
      annualExclusionsByYear: { 2026: 19_000 },
      gifts: [
        { id: "gfm", year: 2026, amount: 19_000, grantor: "client", recipientFamilyMemberId: "fm1", useCrummeyPowers: false } as Gift,
      ],
      giftEvents: [
        { kind: "cash", year: 2026, amount: 19_000, grantor: "client", useCrummeyPowers: true, recipientEntityId: "t1", seriesId: "series-1" },
      ],
    });
    const row = ledger.find((r) => r.year === 2026)!;
    expect(row.perGrantor.client.taxableGiftsThisYear).toBe(0);
  });
});
