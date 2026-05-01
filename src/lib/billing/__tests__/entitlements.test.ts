import { describe, it, expect } from "vitest";
import { deriveEntitlements, type StripeItemView } from "../entitlements";

const mkItem = (over: Partial<StripeItemView>): StripeItemView => ({
  kind: "addon",
  addonKey: "ai_import",
  removed: false,
  ...over,
});

describe("deriveEntitlements", () => {
  it("returns [] for zero items", () => {
    expect(deriveEntitlements([])).toEqual([]);
  });

  it("returns [] when only seat items are present", () => {
    expect(
      deriveEntitlements([{ kind: "seat", addonKey: null, removed: false }]),
    ).toEqual([]);
  });

  it("returns one entitlement for one active addon", () => {
    expect(deriveEntitlements([mkItem({ addonKey: "ai_import" })])).toEqual([
      "ai_import",
    ]);
  });

  it("dedupes duplicate addon keys", () => {
    expect(
      deriveEntitlements([
        mkItem({ addonKey: "ai_import" }),
        mkItem({ addonKey: "ai_import" }),
      ]),
    ).toEqual(["ai_import"]);
  });

  it("excludes removed addons", () => {
    expect(
      deriveEntitlements([mkItem({ addonKey: "ai_import", removed: true })]),
    ).toEqual([]);
  });

  it("excludes addon items with null addonKey (defensive)", () => {
    expect(
      deriveEntitlements([{ kind: "addon", addonKey: null, removed: false }]),
    ).toEqual([]);
  });

  it("returns sorted list with multiple distinct addons", () => {
    expect(
      deriveEntitlements([
        mkItem({ addonKey: "white_label" }),
        mkItem({ addonKey: "ai_import" }),
      ]),
    ).toEqual(["ai_import", "white_label"]);
  });
});
