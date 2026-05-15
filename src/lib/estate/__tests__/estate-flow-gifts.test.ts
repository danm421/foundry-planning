import { describe, it, expect } from "vitest";
import {
  type EstateFlowGift,
  addGift,
  updateGift,
  removeGift,
  applyGiftsToClientData,
} from "../estate-flow-gifts";
import type { ClientData } from "@/engine/types";

function baseData(): ClientData {
  return {
    accounts: [],
    entities: [],
    wills: [],
    gifts: [],
    giftEvents: [],
  } as unknown as ClientData;
}

const cashGift: EstateFlowGift = {
  kind: "cash-once",
  id: "g1",
  year: 2030,
  amount: 50000,
  grantor: "client",
  recipient: { kind: "family_member", id: "fm-kid" },
  crummey: false,
};

const assetGift: EstateFlowGift = {
  kind: "asset-once",
  id: "g2",
  year: 2031,
  accountId: "acc-1",
  percent: 0.4,
  grantor: "spouse",
  recipient: { kind: "entity", id: "trust-1" },
};

const seriesGift: EstateFlowGift = {
  kind: "series",
  id: "s1",
  startYear: 2030,
  endYear: 2032,
  annualAmount: 18000,
  inflationAdjust: false,
  grantor: "client",
  recipient: { kind: "entity", id: "trust-1" },
  crummey: true,
};

describe("applyGiftsToClientData", () => {
  it("materialises a cash-once gift into gifts[] and giftEvents[]", () => {
    const out = applyGiftsToClientData(baseData(), [cashGift], 0.025);
    expect(out.gifts).toHaveLength(1);
    expect(out.gifts?.[0]).toMatchObject({
      id: "g1", year: 2030, amount: 50000, grantor: "client",
      recipientFamilyMemberId: "fm-kid", useCrummeyPowers: false,
    });
    const cashEvents = out.giftEvents.filter((e) => e.kind === "cash");
    expect(cashEvents).toHaveLength(1);
    expect(cashEvents[0]).toMatchObject({ kind: "cash", year: 2030, amount: 50000 });
  });

  it("materialises an asset-once gift into a giftEvents[] asset entry only", () => {
    const out = applyGiftsToClientData(baseData(), [assetGift], 0.025);
    expect(out.gifts ?? []).toHaveLength(0);
    const assetEvents = out.giftEvents.filter((e) => e.kind === "asset");
    expect(assetEvents).toHaveLength(1);
    expect(assetEvents[0]).toMatchObject({
      kind: "asset", year: 2031, accountId: "acc-1", percent: 0.4,
      recipientEntityId: "trust-1",
    });
  });

  it("fans a series gift into one cash giftEvent per year, tagged with seriesId", () => {
    const out = applyGiftsToClientData(baseData(), [seriesGift], 0.025);
    const seriesEvents = out.giftEvents.filter(
      (e) => e.kind === "cash" && e.seriesId === "s1",
    );
    expect(seriesEvents.map((e) => e.year)).toEqual([2030, 2031, 2032]);
  });

  it("does not mutate the input data", () => {
    const input = baseData();
    applyGiftsToClientData(input, [cashGift], 0.025);
    expect(input.gifts).toEqual([]);
    expect(input.giftEvents).toEqual([]);
  });

  it("sorts giftEvents by year ascending", () => {
    const out = applyGiftsToClientData(baseData(), [assetGift, cashGift], 0.025);
    const years = out.giftEvents.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });
});

describe("addGift / updateGift / removeGift", () => {
  it("addGift appends and returns a new array", () => {
    const next = addGift([], cashGift);
    expect(next).toEqual([cashGift]);
  });

  it("updateGift replaces the gift with the matching id", () => {
    const next = updateGift([cashGift], { ...cashGift, amount: 99000 });
    expect(next[0]).toMatchObject({ id: "g1", amount: 99000 });
  });

  it("removeGift drops the gift with the matching id", () => {
    expect(removeGift([cashGift, assetGift], "g1")).toEqual([assetGift]);
  });
});
