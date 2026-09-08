import { describe, it, expect } from "vitest";
import { priorDiscountsBySource, type EstateFlowGift } from "../estate-flow-gifts";

function asset(over: Partial<Extract<EstateFlowGift, { kind: "asset-once" }>>): EstateFlowGift {
  return {
    kind: "asset-once",
    id: "a", year: 2030, accountId: "acct-1", percent: 0.25,
    grantor: "client", recipient: { kind: "entity", id: "t1" },
    ...over,
  } as EstateFlowGift;
}

describe("priorDiscountsBySource", () => {
  it("keys the most recent discount by account", () => {
    const map = priorDiscountsBySource([
      asset({ id: "g1", year: 2030, valuationDiscount: 0.2 }),
      asset({ id: "g2", year: 2033, valuationDiscount: 0.35 }),
    ]);
    expect(map).toEqual({ "acct-1": 0.35 });
  });

  it("keeps the later-listed gift when two share the same year", () => {
    const map = priorDiscountsBySource([
      asset({ id: "g1", year: 2030, valuationDiscount: 0.2 }),
      asset({ id: "g2", year: 2030, valuationDiscount: 0.4 }),
    ]);
    expect(map).toEqual({ "acct-1": 0.4 });
  });

  it("takes the latest year regardless of list order", () => {
    // Falsifies a "last one wins" implementation that ignores the year.
    const map = priorDiscountsBySource([
      asset({ id: "g1", year: 2033, valuationDiscount: 0.35 }),
      asset({ id: "g2", year: 2030, valuationDiscount: 0.2 }),
    ]);
    expect(map).toEqual({ "acct-1": 0.35 });
  });

  it("does NOT let a later undiscounted gift clear an earlier discount", () => {
    const map = priorDiscountsBySource([
      asset({ id: "g1", year: 2030, valuationDiscount: 0.3 }),
      asset({ id: "g2", year: 2035 }),
    ]);
    expect(map).toEqual({ "acct-1": 0.3 });
  });

  it("tracks each account separately", () => {
    const map = priorDiscountsBySource([
      asset({ id: "g1", accountId: "acct-1", valuationDiscount: 0.3 }),
      asset({ id: "g2", accountId: "acct-2", valuationDiscount: 0.15 }),
    ]);
    expect(map).toEqual({ "acct-1": 0.3, "acct-2": 0.15 });
  });

  it("ignores cash and series gifts — prefill is per asset source", () => {
    const map = priorDiscountsBySource([
      { kind: "cash-once", id: "c1", year: 2030, amount: 10_000, grantor: "client",
        recipient: { kind: "entity", id: "t1" }, crummey: false, valuationDiscount: 0.5 },
      { kind: "series", id: "s1", startYear: 2030, endYear: 2032, annualAmount: 1_000,
        amountMode: "fixed", inflationAdjust: false, grantor: "client",
        recipient: { kind: "entity", id: "t1" }, crummey: false, valuationDiscount: 0.5 },
    ]);
    expect(map).toEqual({});
  });

  it("returns an empty map for an empty list", () => {
    expect(priorDiscountsBySource([])).toEqual({});
  });
});
