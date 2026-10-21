import { describe, it, expect } from "vitest";
import { listAlreadyDoneItems } from "../already-done-items";
import type { ClientData, GiftEvent } from "@/engine/types";

const giftToTrust = (year: number, enteredAsHistory: boolean, id: string): GiftEvent => ({
  kind: "asset", year, accountId: "brok", percent: 0.5, grantor: "client",
  recipientEntityId: "t1", sourceGiftId: id, enteredAsHistory,
});

function tree(dataYear: number, giftEvents: GiftEvent[]): ClientData {
  return {
    planSettings: { planStartYear: 2027, planEndYear: 2050, dataYear },
    entities: [{ id: "t1", name: "Smith Family Trust" }],
    giftEvents,
    assetTransactions: [{ id: "s1", name: "Sell the rental", type: "sell", year: 2026, accountId: "rental" }],
    transfers: [
      { id: "x1", name: "Move cash to savings", mode: "one_time", startYear: 2026, sourceAccountId: "a", targetAccountId: "b", amount: 1, growthRate: 0, schedules: [] },
      { id: "x2", name: "Monthly sweep", mode: "recurring", startYear: 2026, sourceAccountId: "a", targetAccountId: "b", amount: 1, growthRate: 0, schedules: [] },
    ],
  } as unknown as ClientData;
}

describe("listAlreadyDoneItems", () => {
  it("lists the one-time items dated in the skipped year", () => {
    const items = listAlreadyDoneItems(tree(2026, [giftToTrust(2026, false, "g1"), giftToTrust(2028, false, "g2")]));
    expect(items).toEqual([
      { kind: "gift", label: "Gift to Smith Family Trust", year: 2026 },
      { kind: "transfer", label: "Move cash to savings", year: 2026 },
      { kind: "asset_sale", label: "Sell the rental", year: 2026 },
    ]);
  });

  it("is empty when the plan starts this year", () => {
    expect(listAlreadyDoneItems(tree(2027, [giftToTrust(2026, false, "g1")]))).toEqual([]);
  });

  it("leaves out a gift entered as history", () => {
    const items = listAlreadyDoneItems(tree(2026, [giftToTrust(2026, true, "g1")]));
    expect(items.some((i) => i.kind === "gift")).toBe(false);
  });
});

describe("listAlreadyDoneItems — stock options", () => {
  it("lists an option exercise the strategy makes in the skipped year", () => {
    const data = {
      planSettings: { planStartYear: 2027, planEndYear: 2050, dataYear: 2026 },
      giftEvents: [],
      stockOptionPlans: [{
        accountId: "so", ticker: "ACME", pricePerShare: 100, growthRate: 0, destinationAccountId: null,
        autoCreateDestination: true, sellToCover: false, withholdingRate: 0, owner: "client",
        strategy: { exerciseTiming: "at_vest", exerciseYear: null, sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null },
        grants: [{
          id: "g1", grantNumber: "NQSO-1", grantType: "nqso", grantDate: "2024-03-01", sharesGranted: 100,
          has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null, expirationYear: 2034, strategy: null,
          tranches: [{ id: "t1", vestDate: "2026-03-01", shares: 100, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null }],
          plannedEvents: [],
        }],
      }],
    } as unknown as ClientData;
    expect(listAlreadyDoneItems(data)).toEqual([{ kind: "stock_exercise", label: "ACME NQSO-1 exercise", year: 2026 }]);
  });
});
