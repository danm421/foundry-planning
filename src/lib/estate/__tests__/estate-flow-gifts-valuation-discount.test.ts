import { describe, it, expect } from "vitest";
import {
  applyGiftsToClientData,
  giftRowToDraft,
  giftSeriesRowToDraft,
  type EstateFlowGift,
  type GiftRow,
  type GiftSeriesDbRow,
} from "@/lib/estate/estate-flow-gifts";
import type { ClientData } from "@/engine/types";

function makeData(): ClientData {
  return {
    gifts: [],
    giftEvents: [],
    liabilities: [],
    taxYearRows: [{ year: 2030, giftAnnualExclusion: 19_000 }],
    planSettings: {
      planStartYear: 2030,
      planEndYear: 2032,
      inflationRate: 0,
      taxInflationRate: 0,
    },
  } as unknown as ClientData;
}

const cashRow: GiftRow = {
  id: "g-cash",
  year: 2030,
  amount: "1000000.00",
  grantor: "client",
  recipientEntityId: "t1",
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  accountId: null,
  liabilityId: null,
  businessEntityId: null,
  percent: null,
  useCrummeyPowers: false,
  eventKind: "outright",
  valuationDiscount: "0.3000",
};

const assetRow: GiftRow = {
  ...cashRow,
  id: "g-asset",
  amount: null,
  accountId: "acct-1",
  percent: "0.2500",
  valuationDiscount: "0.4500",
};

const seriesRow: GiftSeriesDbRow = {
  id: "s1",
  grantor: "client",
  recipientEntityId: "t1",
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  startYear: 2030,
  endYear: 2031,
  annualAmount: "100000.00",
  amountMode: "fixed",
  inflationAdjust: false,
  useCrummeyPowers: false,
  valuationDiscount: "0.2000",
};

describe("giftRowToDraft / giftSeriesRowToDraft — valuationDiscount", () => {
  it("reads the cash row's discount as a number", () => {
    expect(giftRowToDraft(cashRow)).toMatchObject({
      kind: "cash-once",
      valuationDiscount: 0.3,
    });
  });

  it("reads the asset row's discount as a number", () => {
    expect(giftRowToDraft(assetRow)).toMatchObject({
      kind: "asset-once",
      valuationDiscount: 0.45,
    });
  });

  it("reads the series row's discount as a number", () => {
    expect(giftSeriesRowToDraft(seriesRow)).toMatchObject({
      kind: "series",
      valuationDiscount: 0.2,
    });
  });

  it("leaves the discount undefined when the column is NULL", () => {
    // All THREE branches, not just cash and series: the asset branch keeps its
    // own copy of this ternary, so a `?? 0` slipping into it is invisible here
    // without the middle case. (The JSON-absence half of the contract is
    // pinned separately in estate-flow-gift-diff.test.ts.)
    expect(
      giftRowToDraft({ ...cashRow, valuationDiscount: null }),
    ).toMatchObject({ valuationDiscount: undefined });
    expect(
      giftRowToDraft({ ...assetRow, valuationDiscount: null }),
    ).toMatchObject({ kind: "asset-once", valuationDiscount: undefined });
    expect(
      giftSeriesRowToDraft({ ...seriesRow, valuationDiscount: null }),
    ).toMatchObject({ valuationDiscount: undefined });
  });

  it("emits valuationDiscount as the LAST key so the JSON.stringify diff contract holds", () => {
    const cash = giftRowToDraft(cashRow)!;
    const asset = giftRowToDraft(assetRow)!;
    const series = giftSeriesRowToDraft(seriesRow);
    expect(Object.keys(cash).at(-1)).toBe("valuationDiscount");
    expect(Object.keys(asset).at(-1)).toBe("valuationDiscount");
    expect(Object.keys(series).at(-1)).toBe("valuationDiscount");
  });
});

describe("applyGiftsToClientData — valuationDiscount", () => {
  it("puts the discount on the cash Gift[] entry and its cash GiftEvent", () => {
    const draft = giftRowToDraft(cashRow)!;
    const out = applyGiftsToClientData(makeData(), [draft], 0);
    expect(out.gifts?.[0].valuationDiscount).toBe(0.3);
    const cashEvent = out.giftEvents.find((e) => e.kind === "cash")!;
    if (cashEvent.kind === "cash") expect(cashEvent.valuationDiscount).toBe(0.3);
  });

  it("puts the discount on the asset GiftEvent", () => {
    const draft = giftRowToDraft(assetRow)!;
    const out = applyGiftsToClientData(makeData(), [draft], 0);
    const assetEvent = out.giftEvents.find((e) => e.kind === "asset")!;
    if (assetEvent.kind === "asset") expect(assetEvent.valuationDiscount).toBe(0.45);
  });

  it("applies the series discount to every fanned-out occurrence", () => {
    const draft = giftSeriesRowToDraft(seriesRow);
    const out = applyGiftsToClientData(makeData(), [draft], 0);
    const cashEvents = out.giftEvents.filter((e) => e.kind === "cash");
    expect(cashEvents).toHaveLength(2);
    for (const e of cashEvents) {
      if (e.kind === "cash") expect(e.valuationDiscount).toBe(0.2);
    }
  });

  it("round-trips: a draft carrying a discount survives materialisation and re-draft", () => {
    const draft = giftRowToDraft(assetRow)!;
    const out = applyGiftsToClientData(makeData(), [draft], 0);
    const assetEvent = out.giftEvents.find((e) => e.kind === "asset")!;
    if (assetEvent.kind === "asset") {
      expect(assetEvent.percent).toBe(0.25);
      expect(assetEvent.valuationDiscount).toBe(0.45);
      // percent is the ownership fraction and must never absorb the discount.
      expect(assetEvent.percent).not.toBe(0.25 * (1 - 0.45));
    }
  });

  it("does not put a discount on the auto-derived liability GiftEvent", () => {
    const data = {
      ...makeData(),
      liabilities: [{ id: "liab-1", linkedPropertyId: "acct-1" }],
    } as unknown as ClientData;
    const draft = giftRowToDraft(assetRow)!;
    const out = applyGiftsToClientData(data, [draft], 0);
    const liabEvent = out.giftEvents.find((e) => e.kind === "liability")!;
    expect(liabEvent).toBeDefined();
    expect("valuationDiscount" in liabEvent).toBe(false);
  });
});

describe("EstateFlowGift — discount is optional", () => {
  it("compiles and materialises a gift with no discount at all", () => {
    const g: EstateFlowGift = {
      kind: "cash-once",
      id: "g-plain",
      year: 2030,
      amount: 50_000,
      grantor: "client",
      recipient: { kind: "entity", id: "t1" },
      crummey: false,
    };
    const out = applyGiftsToClientData(makeData(), [g], 0);
    expect(out.gifts?.[0].valuationDiscount).toBeUndefined();
  });
});
