import { describe, it, expect } from "vitest";
import {
  giftScenarioAdd,
  giftScenarioRemove,
  assertDraftable,
  assertNotPastDatedAssetGift,
} from "@/lib/gifts/gift-write";
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

describe("assertNotPastDatedAssetGift", () => {
  // Mirrors the server rule exactly: `POST /gifts` dual-writes `account_owners`
  // only for an asset (or liability) transfer TO AN ENTITY dated before the
  // plan's start year. A scenario cannot make that write, so that one shape is
  // refused and nothing else is.
  const assetGift: EstateFlowGift = {
    kind: "asset-once",
    id: "33333333-3333-3333-3333-333333333333",
    year: 2019,
    accountId: "44444444-4444-4444-4444-444444444444",
    percent: 0.4,
    grantor: "client",
    recipient: { kind: "entity", id: "22222222-2222-2222-2222-222222222222" },
  };
  const inScenario = { scenarioActive: true, planStartYear: 2026 };

  it("refuses a past-dated asset transfer to a trust, naming both years", () => {
    expect(() => assertNotPastDatedAssetGift(assetGift, inScenario)).toThrow(
      /dated 2019, before the plan starts in 2026/i,
    );
  });

  it("allows the same transfer once it is dated inside the plan", () => {
    expect(() =>
      assertNotPastDatedAssetGift({ ...assetGift, year: 2026 }, inScenario),
    ).not.toThrow();
  });

  it("allows it in the base plan, where the route DOES move the ownership", () => {
    expect(() =>
      assertNotPastDatedAssetGift(assetGift, {
        scenarioActive: false,
        planStartYear: 2026,
      }),
    ).not.toThrow();
  });

  it("leaves a past-dated CASH gift alone — it writes no ownership either way", () => {
    expect(() =>
      assertNotPastDatedAssetGift({ ...draft, year: 2019 }, inScenario),
    ).not.toThrow();
  });

  it("leaves an asset transfer to a PERSON alone — the route's dual-write is entity-only", () => {
    expect(() =>
      assertNotPastDatedAssetGift(
        {
          ...assetGift,
          recipient: { kind: "family_member", id: "55555555-5555-5555-5555-555555555555" },
        },
        inScenario,
      ),
    ).not.toThrow();
  });

  it("stands down when the plan start year is unknown rather than guessing", () => {
    // A calendar-year stand-in is not the rule the server applies, and refusing
    // a legal save on a guess is worse than the silence this guard exists for.
    expect(() =>
      assertNotPastDatedAssetGift(assetGift, { scenarioActive: true, planStartYear: null }),
    ).not.toThrow();
  });
});
