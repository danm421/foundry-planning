import { describe, it, expect } from "vitest";
import { giftScenarioAdd, giftScenarioRemove, assertDraftable } from "@/lib/gifts/gift-write";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

const draft: EstateFlowGift = {
  kind: "cash-once",
  id: "11111111-1111-1111-1111-111111111111",
  year: 2027,
  grantor: "client",
  recipient: { kind: "entity", id: "22222222-2222-2222-2222-222222222222" },
  amount: 50_000,
  crummey: true,
};

describe("giftScenarioAdd", () => {
  it("uses op 'add' even for an edit, so the overlay re-materialises the gift", () => {
    expect(giftScenarioAdd(draft)).toEqual({
      op: "add",
      targetKind: "gift",
      entity: draft,
    });
  });

  it("carries the draft's own id, which is what strips the base row", () => {
    const edit = giftScenarioAdd(draft);
    expect((edit.entity as { id: string }).id).toBe(draft.id);
  });
});

describe("giftScenarioRemove", () => {
  it("targets the gift by id", () => {
    expect(giftScenarioRemove("abc")).toEqual({
      op: "remove",
      targetKind: "gift",
      targetId: "abc",
    });
  });
});

describe("assertDraftable", () => {
  it("returns the draft when it is representable", () => {
    expect(assertDraftable(draft, "test")).toBe(draft);
  });

  it("throws for a gift the overlay cannot carry, instead of writing to the base plan", () => {
    expect(() => assertDraftable(null, "business-interest gift")).toThrow(
      /cannot be saved into a scenario/i,
    );
  });
});
