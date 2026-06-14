import { describe, it, expect } from "vitest";
import { deriveEntitlements, type StripeItemView } from "../entitlements";

const seat: StripeItemView = { kind: "seat", addonKey: null, removed: false };
const mkAddon = (over: Partial<StripeItemView>): StripeItemView => ({
  kind: "addon",
  addonKey: "white_label",
  removed: false,
  ...over,
});

describe("deriveEntitlements", () => {
  it("returns [] when there are no items", () => {
    expect(deriveEntitlements({ items: [] })).toEqual([]);
  });

  it("grants the bundled seat entitlements (ai_copilot + ai_import) for any active seat", () => {
    expect(deriveEntitlements({ items: [seat] })).toEqual(["ai_copilot", "ai_import"]);
  });

  it("returns [] when the only seat item is removed", () => {
    expect(deriveEntitlements({ items: [{ ...seat, removed: true }] })).toEqual([]);
  });

  it("unions the seat-included entitlements with a generic addon, sorted", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ addonKey: "white_label" })] }),
    ).toEqual(["ai_copilot", "ai_import", "white_label"]);
  });

  it("grants a generic addon entitlement even without a seat", () => {
    expect(
      deriveEntitlements({ items: [mkAddon({ addonKey: "white_label" })] }),
    ).toEqual(["white_label"]);
  });

  it("excludes removed addons", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ removed: true })] }),
    ).toEqual(["ai_copilot", "ai_import"]);
  });

  it("excludes addon items with a null addonKey (defensive)", () => {
    expect(
      deriveEntitlements({
        items: [{ kind: "addon", addonKey: null, removed: false }],
      }),
    ).toEqual([]);
  });

  it("dedupes when an addon key duplicates a seat-included entitlement", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ addonKey: "ai_import" })] }),
    ).toEqual(["ai_copilot", "ai_import"]);
  });
});
