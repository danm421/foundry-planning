import { describe, it, expect } from "vitest";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { overlayGiftDrafts } from "../apply-gift-overlays";

const baseCash: EstateFlowGift = {
  kind: "cash-once", id: "base-g", year: 2030, amount: 10000,
  grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false,
};
const baseSeries: EstateFlowGift = {
  kind: "series", id: "base-s", startYear: 2027, endYear: 2031, annualAmount: 19000,
  amountMode: "fixed", inflationAdjust: false, grantor: "spouse",
  recipient: { kind: "family_member", id: "fm1" }, crummey: true,
};

const ch = (
  opType: "add" | "remove",
  targetId: string,
  payload: unknown,
): ScenarioChange => ({
  id: `c-${targetId}`, scenarioId: "s", opType, targetKind: "gift",
  targetId, payload, toggleGroupId: null, orderIndex: 0,
});

describe("overlayGiftDrafts", () => {
  it("appends a scenario-only gift to the base list", () => {
    const added = {
      kind: "asset-once", id: "new-g", year: 2026, accountId: "acct-1", percent: 0.15,
      grantor: "client", recipient: { kind: "entity", id: "slat-1" },
    };
    const out = overlayGiftDrafts([baseCash], [ch("add", "new-g", added)]);
    expect(out.map((g) => g.id)).toEqual(["base-g", "new-g"]);
  });

  it("replaces a base gift in place when the scenario edits it", () => {
    const edited = { ...baseCash, amount: 25000 };
    const out = overlayGiftDrafts([baseCash, baseSeries], [ch("add", "base-g", edited)]);
    expect(out).toHaveLength(2);
    expect(out.find((g) => g.id === "base-g")).toMatchObject({ amount: 25000 });
  });

  it("drops a base gift the scenario removed", () => {
    const out = overlayGiftDrafts([baseCash, baseSeries], [ch("remove", "base-s", null)]);
    expect(out.map((g) => g.id)).toEqual(["base-g"]);
  });

  it("ignores an add payload that isn't a gift draft", () => {
    const out = overlayGiftDrafts([baseCash], [ch("add", "junk", { amount: 5 })]);
    expect(out.map((g) => g.id)).toEqual(["base-g"]);
  });

  it("no gift changes is identity", () => {
    const base = [baseCash];
    expect(overlayGiftDrafts(base, [])).toBe(base);
  });
});
