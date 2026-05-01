import { describe, it, expect } from "vitest";
import { deriveEntitlements, type StripeItemView } from "../entitlements";

const mkItem = (over: Partial<StripeItemView>): StripeItemView => ({
  kind: "addon",
  addonKey: "ai_import",
  removed: false,
  ...over,
});

const seat: StripeItemView = { kind: "seat", addonKey: null, removed: false };

describe("deriveEntitlements", () => {
  it("returns [] for zero items and quota exhausted", () => {
    expect(deriveEntitlements({ items: [], aiImportsUsed: 3 })).toEqual([]);
  });

  it("returns [] when only seat items are present and quota exhausted", () => {
    expect(deriveEntitlements({ items: [seat], aiImportsUsed: 3 })).toEqual([]);
  });

  it("returns one entitlement for one active addon", () => {
    expect(
      deriveEntitlements({
        items: [mkItem({ addonKey: "ai_import" })],
        aiImportsUsed: 3,
      }),
    ).toEqual(["ai_import"]);
  });

  it("dedupes when both Stripe addon active AND free quota remaining", () => {
    expect(
      deriveEntitlements({
        items: [mkItem({ addonKey: "ai_import" })],
        aiImportsUsed: 0,
      }),
    ).toEqual(["ai_import"]);
  });

  it("excludes removed addons", () => {
    expect(
      deriveEntitlements({
        items: [mkItem({ addonKey: "ai_import", removed: true })],
        aiImportsUsed: 3,
      }),
    ).toEqual([]);
  });

  it("excludes addon items with null addonKey (defensive)", () => {
    expect(
      deriveEntitlements({
        items: [{ kind: "addon", addonKey: null, removed: false }],
        aiImportsUsed: 3,
      }),
    ).toEqual([]);
  });

  it("returns sorted list with multiple distinct addons", () => {
    expect(
      deriveEntitlements({
        items: [
          mkItem({ addonKey: "white_label" }),
          mkItem({ addonKey: "ai_import" }),
        ],
        aiImportsUsed: 3,
      }),
    ).toEqual(["ai_import", "white_label"]);
  });

  it("free-quota: ai_imports_used < 3 grants ai_import even with no addon line", () => {
    expect(deriveEntitlements({ items: [seat], aiImportsUsed: 0 })).toEqual([
      "ai_import",
    ]);
    expect(deriveEntitlements({ items: [seat], aiImportsUsed: 2 })).toEqual([
      "ai_import",
    ]);
  });

  it("free-quota: ai_imports_used >= 3 does NOT grant ai_import", () => {
    expect(deriveEntitlements({ items: [seat], aiImportsUsed: 3 })).toEqual([]);
    expect(deriveEntitlements({ items: [seat], aiImportsUsed: 99 })).toEqual([]);
  });

  it("free-quota union with white_label addon stays sorted", () => {
    expect(
      deriveEntitlements({
        items: [seat, mkItem({ addonKey: "white_label" })],
        aiImportsUsed: 0,
      }),
    ).toEqual(["ai_import", "white_label"]);
  });
});
