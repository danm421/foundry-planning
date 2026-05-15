import { describe, it, expect } from "vitest";
import { diffGifts } from "../estate-flow-gift-diff";
import type { EstateFlowGift } from "../estate-flow-gifts";

const g1: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2030, amount: 50000,
  grantor: "client", recipient: { kind: "family_member", id: "fm-kid" }, crummey: false,
};
const g2: EstateFlowGift = {
  kind: "series", id: "s1", startYear: 2030, endYear: 2035, annualAmount: 18000,
  inflationAdjust: true, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: true,
};

describe("diffGifts", () => {
  it("returns no changes when the lists are equal", () => {
    expect(diffGifts([g1], [g1])).toEqual([]);
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
