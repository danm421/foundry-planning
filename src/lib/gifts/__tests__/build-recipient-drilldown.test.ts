import { describe, it, expect } from "vitest";
import {
  buildRecipientDrilldown,
  type BuildRecipientDrilldownInput,
} from "../build-recipient-drilldown";
import type { Gift, GiftEvent, EntitySummary } from "@/engine/types";

const ent1Trust = {
  id: "ent-1",
  name: "Sample Family ILIT",
  entityType: "trust",
  isIrrevocable: true,
  crummeyPowers: false,
  includeInPortfolio: false,
  isGrantor: false,
  beneficiaries: [],
} as unknown as EntitySummary;

function baseInput(
  over: Partial<BuildRecipientDrilldownInput> = {},
): BuildRecipientDrilldownInput {
  return {
    year: 2028,
    gifts: [],
    giftEvents: [],
    entities: [ent1Trust],
    familyMembersById: new Map([
      ["fm-1", { firstName: "Caroline", lastName: "Sample" }],
      ["fm-2", { firstName: "Henry", lastName: "Sample" }],
    ]),
    entitiesById: new Map([["ent-1", { name: "Sample Family ILIT" }]]),
    externalBeneficiariesById: new Map([
      ["eb-1", { name: "Default Charity", kind: "charity" }],
      ["eb-2", { name: "Generic Friend", kind: "individual" }],
    ]),
    annualExclusion: 20_000,
    accountValueAtYear: () => 0,
    ...over,
  };
}

describe("buildRecipientDrilldown", () => {
  it("returns no groups when there are no gifts in the year", () => {
    expect(buildRecipientDrilldown(baseInput())).toEqual([]);
  });

  it("groups single-grantor cash gift to a family member with one AE applied", () => {
    const gift: Gift = {
      id: "g1",
      year: 2028,
      amount: 50_000,
      grantor: "client",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const groups = buildRecipientDrilldown(baseInput({ gifts: [gift] }));
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Caroline Sample");
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0]).toMatchObject({
      amount: 50_000,
      giftValue: 50_000,
      exclusion: 20_000,
      taxableGift: 30_000,
    });
    expect(groups[0].subtotal).toMatchObject({
      amount: 50_000,
      exclusion: 20_000,
      taxableGift: 30_000,
    });
  });

  it("joint cash gift splits into two half-gifts that aggregate two AEs", () => {
    const gift: Gift = {
      id: "g1",
      year: 2028,
      amount: 50_000,
      grantor: "joint",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const groups = buildRecipientDrilldown(baseInput({ gifts: [gift] }));
    // §2513: joint gift splits into client + spouse half-gifts (25k each).
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].rows[0]).toMatchObject({
      amount: 25_000,
      exclusion: 20_000,
      taxableGift: 5_000,
    });
    expect(groups[0].subtotal).toMatchObject({
      amount: 50_000,
      exclusion: 40_000,
      taxableGift: 10_000,
    });
  });

  it("charitable cash gift renders fully excluded (charitable) and 0 taxable", () => {
    const gift: Gift = {
      id: "g1",
      year: 2028,
      amount: 500_000,
      grantor: "client",
      recipientExternalBeneficiaryId: "eb-1",
      useCrummeyPowers: false,
    };
    const groups = buildRecipientDrilldown(baseInput({ gifts: [gift] }));
    expect(groups[0].label).toBe("Default Charity");
    // Unified model: charitable gifts net to lifetimeUsed 0 via the charitable
    // exclusion, so the full amount surfaces as exclusion (was 0 pre-unification).
    expect(groups[0].rows[0]).toMatchObject({
      amount: 500_000,
      giftValue: 500_000,
      exclusion: 500_000,
      taxableGift: 0,
    });
  });

  it("asset GiftEvent uses amountOverride when present (no AE applied)", () => {
    const ev: GiftEvent = {
      kind: "asset",
      year: 2028,
      grantor: "client",
      accountId: "acc-1",
      percent: 1,
      amountOverride: 250_000,
      recipientEntityId: "ent-1",
    };
    const groups = buildRecipientDrilldown(baseInput({ giftEvents: [ev] }));
    expect(groups[0].label).toBe("Sample Family ILIT");
    expect(groups[0].rows[0]).toMatchObject({
      amount: 250_000,
      giftValue: 250_000,
      exclusion: 0,
      taxableGift: 250_000,
    });
  });

  it("asset GiftEvent without amountOverride falls back to accountValueAtYear × percent", () => {
    const ev: GiftEvent = {
      kind: "asset",
      year: 2028,
      grantor: "client",
      accountId: "acc-1",
      percent: 0.5,
      recipientEntityId: "ent-1",
    };
    const groups = buildRecipientDrilldown(
      baseInput({
        giftEvents: [ev],
        accountValueAtYear: (id) => (id === "acc-1" ? 800_000 : 0),
      }),
    );
    expect(groups[0].rows[0]).toMatchObject({
      amount: 400_000,
      giftValue: 400_000,
    });
  });

  it("pools one §2503(b) annual exclusion across multiple gifts to the same donee", () => {
    const g1: Gift = {
      id: "g1",
      year: 2028,
      amount: 30_000,
      grantor: "client",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const g2: Gift = {
      id: "g2",
      year: 2028,
      amount: 50_000,
      grantor: "client",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const groups = buildRecipientDrilldown(baseInput({ gifts: [g1, g2] }));
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
    // §2503(b): ONE $20k annual exclusion for the donee that year — not one per
    // gift. The pooled exclusion is allocated earliest-row-first.
    expect(groups[0].rows[0]).toMatchObject({
      amount: 30_000,
      exclusion: 20_000,
      taxableGift: 10_000,
    });
    expect(groups[0].rows[1]).toMatchObject({
      amount: 50_000,
      exclusion: 0,
      taxableGift: 50_000,
    });
    expect(groups[0].subtotal).toMatchObject({
      amount: 80_000,
      exclusion: 20_000,
      taxableGift: 60_000,
    });
    // Per-row exclusion sums to the group exclusion.
    expect(
      groups[0].rows.reduce((s, r) => s + r.exclusion, 0),
    ).toBe(groups[0].subtotal.exclusion);
  });

  it("a single gift to a donee still claims one full annual exclusion (no regression)", () => {
    const g1: Gift = {
      id: "g1",
      year: 2028,
      amount: 50_000,
      grantor: "client",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const groups = buildRecipientDrilldown(baseInput({ gifts: [g1] }));
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0]).toMatchObject({
      amount: 50_000,
      exclusion: 20_000,
      taxableGift: 30_000,
    });
    expect(groups[0].subtotal).toMatchObject({
      exclusion: 20_000,
      taxableGift: 30_000,
    });
  });

  it("a mixed cash + asset group does not pool the cash exclusion against the asset", () => {
    // Crummey cash to the trust is AE-eligible; the asset transfer is not. The
    // shared exclusion must apply only to the cash, never to the asset amount.
    const trust = {
      id: "t1",
      name: "Mixed ILIT",
      entityType: "trust",
      isIrrevocable: true,
      crummeyPowers: true,
      includeInPortfolio: false,
      isGrantor: false,
      beneficiaries: [
        {
          id: "b1",
          tier: "primary",
          percentage: 100,
          familyMemberId: "k1",
          sortOrder: 0,
        },
      ],
    } as unknown as EntitySummary;
    const cash: GiftEvent = {
      kind: "cash",
      year: 2028,
      amount: 30_000,
      grantor: "client",
      useCrummeyPowers: true,
      recipientEntityId: "t1",
      sourcePolicyAccountId: "p1",
    };
    const asset: GiftEvent = {
      kind: "asset",
      year: 2028,
      grantor: "client",
      accountId: "acc-1",
      percent: 1,
      amountOverride: 100_000,
      recipientEntityId: "t1",
    };
    const groups = buildRecipientDrilldown({
      year: 2028,
      gifts: [],
      giftEvents: [cash, asset],
      familyMembersById: new Map(),
      entitiesById: new Map([["t1", { name: "Mixed ILIT" }]]),
      externalBeneficiariesById: new Map(),
      entities: [trust],
      annualExclusion: 18_000,
      accountValueAtYear: () => 0,
    });
    const grp = groups.find((g) => g.label === "Mixed ILIT")!;
    // Cash row: 30k − 18k AE = 12k taxable. Asset row: full 100k taxable, 0 AE.
    expect(grp.subtotal).toMatchObject({
      amount: 130_000,
      exclusion: 18_000,
      taxableGift: 112_000,
    });
    const assetRow = grp.rows.find((r) => r.amount === 100_000)!;
    expect(assetRow).toMatchObject({ exclusion: 0, taxableGift: 100_000 });
    const cashRow = grp.rows.find((r) => r.amount === 30_000)!;
    expect(cashRow).toMatchObject({ exclusion: 18_000, taxableGift: 12_000 });
  });

  it("filters out gifts from other years", () => {
    const g1: Gift = {
      id: "g1",
      year: 2027,
      amount: 50_000,
      grantor: "client",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const g2: Gift = {
      id: "g2",
      year: 2028,
      amount: 30_000,
      grantor: "client",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const groups = buildRecipientDrilldown(baseInput({ gifts: [g1, g2] }));
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].amount).toBe(30_000);
  });

  it("orders groups: family members alpha, then entities alpha, then external beneficiaries alpha", () => {
    const g1: Gift = {
      id: "g1",
      year: 2028,
      amount: 1,
      grantor: "client",
      recipientExternalBeneficiaryId: "eb-2",
      useCrummeyPowers: false,
    };
    const g2: Gift = {
      id: "g2",
      year: 2028,
      amount: 1,
      grantor: "client",
      recipientFamilyMemberId: "fm-2",
      useCrummeyPowers: false,
    };
    const g3: Gift = {
      id: "g3",
      year: 2028,
      amount: 1,
      grantor: "client",
      recipientEntityId: "ent-1",
      useCrummeyPowers: false,
    };
    const g4: Gift = {
      id: "g4",
      year: 2028,
      amount: 1,
      grantor: "client",
      recipientFamilyMemberId: "fm-1",
      useCrummeyPowers: false,
    };
    const groups = buildRecipientDrilldown(
      baseInput({ gifts: [g1, g2, g3, g4] }),
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Caroline Sample",
      "Henry Sample",
      "Sample Family ILIT",
      "Generic Friend",
    ]);
  });

  it("renders a premium gift to a trust with Crummey exclusion", () => {
    const trust = {
      id: "t1",
      name: "ILIT",
      entityType: "trust",
      isIrrevocable: true,
      crummeyPowers: true,
      includeInPortfolio: false,
      isGrantor: false,
      beneficiaries: [
        {
          id: "b1",
          tier: "primary",
          percentage: 100,
          familyMemberId: "k1",
          sortOrder: 0,
        },
      ],
    } as unknown as import("@/engine/types").EntitySummary;
    const groups = buildRecipientDrilldown({
      year: 2030,
      gifts: [],
      giftEvents: [
        {
          kind: "cash",
          year: 2030,
          amount: 30_000,
          grantor: "client",
          useCrummeyPowers: true,
          recipientEntityId: "t1",
          sourcePolicyAccountId: "p1",
        },
      ],
      familyMembersById: new Map(),
      entitiesById: new Map([["t1", { name: "ILIT" }]]),
      externalBeneficiariesById: new Map(),
      entities: [trust],
      annualExclusion: 18_000,
      accountValueAtYear: () => 0,
    });
    const ilit = groups.find((g) => g.label === "ILIT")!;
    expect(ilit.subtotal.taxableGift).toBe(12_000); // 30k − 18k×1
    expect(ilit.subtotal.exclusion).toBe(18_000);
  });

  it("annotates clt_remainder_interest gifts with CLT trust name in description", () => {
    const remainderGift: Gift = {
      id: "g-clut",
      year: 2028,
      amount: 538_615,
      grantor: "client",
      recipientEntityId: "ent-1",
      useCrummeyPowers: false,
      eventKind: "clt_remainder_interest",
    };
    const groups = buildRecipientDrilldown(
      baseInput({ gifts: [remainderGift] }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Sample Family ILIT");
    expect(groups[0].rows[0].description).toMatch(
      /CLT Sample Family ILIT.*remainder interest/i,
    );
  });
});
