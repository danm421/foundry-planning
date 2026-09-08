import { describe, it, expect } from "vitest";
import { diffGifts } from "../estate-flow-gift-diff";
import {
  giftRowToDraft,
  giftSeriesRowToDraft,
  type EstateFlowGift,
} from "../estate-flow-gifts";

const g1: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2030, amount: 50000,
  grantor: "client", recipient: { kind: "family_member", id: "fm-kid" }, crummey: false,
};
const g2: EstateFlowGift = {
  kind: "series", id: "s1", startYear: 2030, endYear: 2035, annualAmount: 18000,
  amountMode: "fixed", inflationAdjust: true, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: true,
};

describe("diffGifts", () => {
  it("returns no changes when the lists are equal (same reference)", () => {
    expect(diffGifts([g1], [g1])).toEqual([]);
  });

  it("returns no changes for distinct but value-equal gift objects (proves value equality, not reference equality)", () => {
    expect(diffGifts([g1], [{ ...g1 }])).toEqual([]);
  });

  it("classifies a gift present only in working as an add", () => {
    const out = diffGifts([], [g1]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ op: "add", gift: g1 });
  });

  it("classifies a gift present only in initial as a remove", () => {
    const out = diffGifts([g1], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ op: "remove", gift: g1 });
  });

  it("classifies a changed gift as an update carrying the new state", () => {
    const out = diffGifts([g1], [{ ...g1, amount: 99000 }]);
    expect(out).toHaveLength(1);
    expect(out[0].op).toBe("update");
    expect(out[0].gift).toMatchObject({ id: "g1", amount: 99000 });
  });

  it("emits nothing for an unchanged gift among changed ones", () => {
    const out = diffGifts([g1, g2], [g1, { ...g2, annualAmount: 20000 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ op: "update", gift: { id: "s1", annualAmount: 20000 } });
  });

  it("orders output: removes before updates before adds", () => {
    const g3: EstateFlowGift = {
      kind: "cash-once", id: "g3", year: 2031, amount: 10000,
      grantor: "spouse", recipient: { kind: "entity", id: "t2" }, crummey: false,
    };
    // g1 removed, g2 updated, g3 added
    const out = diffGifts([g1, g2], [{ ...g2, annualAmount: 20000 }, g3]);
    expect(out).toHaveLength(3);
    expect(out[0].op).toBe("remove");
    expect(out[1].op).toBe("update");
    expect(out[2].op).toBe("add");
  });

  it("returns a description string on each change", () => {
    const out = diffGifts([], [g1]);
    expect(typeof out[0].description).toBe("string");
    expect(out[0].description.length).toBeGreaterThan(0);
  });
});

describe("diffGifts — valuationDiscount key-position contract", () => {
  const cashDiscounted = giftRowToDraft({
    id: "g-cash-d", year: 2030, amount: "1000000.00", grantor: "client",
    recipientEntityId: "t1", recipientFamilyMemberId: null,
    recipientExternalBeneficiaryId: null, accountId: null, liabilityId: null,
    businessEntityId: null, percent: null, useCrummeyPowers: false,
    eventKind: "outright", valuationDiscount: "0.3000",
  })!;

  const cashPlain = giftRowToDraft({
    id: "g-cash-p", year: 2030, amount: "50000.00", grantor: "client",
    recipientEntityId: null, recipientFamilyMemberId: "fm-kid",
    recipientExternalBeneficiaryId: null, accountId: null, liabilityId: null,
    businessEntityId: null, percent: null, useCrummeyPowers: false,
    eventKind: "outright", valuationDiscount: null,
  })!;

  const assetDiscounted = giftRowToDraft({
    id: "g-asset-d", year: 2031, amount: null, grantor: "spouse",
    recipientEntityId: "t1", recipientFamilyMemberId: null,
    recipientExternalBeneficiaryId: null, accountId: "acct-1", liabilityId: null,
    businessEntityId: null, percent: "0.2500", useCrummeyPowers: false,
    eventKind: "outright", valuationDiscount: "0.4500",
  })!;

  const assetPlain = giftRowToDraft({
    id: "g-asset-p", year: 2031, amount: null, grantor: "client",
    recipientEntityId: "t1", recipientFamilyMemberId: null,
    recipientExternalBeneficiaryId: null, accountId: "acct-2", liabilityId: null,
    businessEntityId: null, percent: "1.0000", useCrummeyPowers: false,
    eventKind: "outright", valuationDiscount: null,
  })!;

  const seriesDiscounted = giftSeriesRowToDraft({
    id: "s-d", grantor: "joint", recipientEntityId: "t1",
    recipientFamilyMemberId: null, recipientExternalBeneficiaryId: null,
    startYear: 2030, endYear: 2035, annualAmount: "100000.00",
    amountMode: "fixed", inflationAdjust: true, useCrummeyPowers: true,
    valuationDiscount: "0.2000",
  });

  const seriesPlain = giftSeriesRowToDraft({
    id: "s-p", grantor: "client", recipientEntityId: "t1",
    recipientFamilyMemberId: null, recipientExternalBeneficiaryId: null,
    startYear: 2030, endYear: 2032, annualAmount: "19000.00",
    amountMode: "annual_exclusion", inflationAdjust: false,
    useCrummeyPowers: true, valuationDiscount: null,
  });

  const all = [
    cashDiscounted, cashPlain,
    assetDiscounted, assetPlain,
    seriesDiscounted, seriesPlain,
  ];

  it("reports NO phantom edits for a mixed fixture of all three kinds", () => {
    expect(diffGifts(all, all)).toEqual([]);
  });

  it("reports NO phantom edits when each gift is shallow-cloned", () => {
    expect(diffGifts(all, all.map((g) => ({ ...g })))).toEqual([]);
  });

  it("still detects a real discount change as an update", () => {
    const edited = all.map((g) =>
      g.id === "g-asset-d" ? { ...g, valuationDiscount: 0.5 } : g,
    );
    const out = diffGifts(all, edited);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ op: "update", gift: { id: "g-asset-d" } });
  });

  it("detects adding a discount to a previously undiscounted gift", () => {
    const edited = all.map((g) =>
      g.id === "g-asset-p" ? { ...g, valuationDiscount: 0.25 } : g,
    );
    const out = diffGifts(all, edited);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ op: "update", gift: { id: "g-asset-p" } });
  });

  it("treats clearing a discount back to undefined as a return to the original", () => {
    const bumped = all.map((g) =>
      g.id === "g-asset-p" ? { ...g, valuationDiscount: 0.25 } : g,
    );
    const restored = bumped.map((g) =>
      g.id === "g-asset-p" ? { ...g, valuationDiscount: undefined } : g,
    );
    expect(diffGifts(all, restored)).toEqual([]);
  });
});
