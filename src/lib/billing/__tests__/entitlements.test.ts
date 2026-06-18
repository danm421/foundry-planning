import { describe, it, expect } from "vitest";
import {
  deriveEntitlements,
  type StripeItemView,
  type EntitlementOverride,
} from "../entitlements";

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
    expect(deriveEntitlements({ items: [seat] })).toEqual(["ai_copilot", "ai_forge", "ai_import"]);
  });

  it("returns [] when the only seat item is removed", () => {
    expect(deriveEntitlements({ items: [{ ...seat, removed: true }] })).toEqual([]);
  });

  it("unions the seat-included entitlements with a generic addon, sorted", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ addonKey: "white_label" })] }),
    ).toEqual(["ai_copilot", "ai_forge", "ai_import", "white_label"]);
  });

  it("grants a generic addon entitlement even without a seat", () => {
    expect(
      deriveEntitlements({ items: [mkAddon({ addonKey: "white_label" })] }),
    ).toEqual(["white_label"]);
  });

  it("excludes removed addons", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ removed: true })] }),
    ).toEqual(["ai_copilot", "ai_forge", "ai_import"]);
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
    ).toEqual(["ai_copilot", "ai_forge", "ai_import"]);
  });
});

describe("deriveEntitlements — override union (final step)", () => {
  it("a grant adds a key the subscription does not imply", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "ai_copilot", mode: "grant" }];
    expect(deriveEntitlements({ items: [], overrides })).toEqual(["ai_copilot"]);
  });

  it("a revoke removes a seat-included key", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "ai_import", mode: "revoke" }];
    // A seat grants the seat-included keys; revoking ai_import leaves the AI
    // assistant keys (ai_copilot legacy + ai_forge) during the dual-read window.
    expect(deriveEntitlements({ items: [seat], overrides })).toEqual(["ai_copilot", "ai_forge"]);
  });

  it("a grant is idempotent with a seat-included key", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "ai_import", mode: "grant" }];
    expect(deriveEntitlements({ items: [seat], overrides })).toEqual(["ai_copilot", "ai_forge", "ai_import"]);
  });

  it("applies overrides in array order — later wins", () => {
    const overrides: EntitlementOverride[] = [
      { entitlement: "ai_import", mode: "grant" },
      { entitlement: "ai_import", mode: "revoke" },
    ];
    expect(deriveEntitlements({ items: [], overrides })).toEqual([]);
  });

  it("keeps output sorted after applying a grant", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "white_label", mode: "grant" }];
    expect(deriveEntitlements({ items: [seat], overrides })).toEqual(["ai_copilot", "ai_forge", "ai_import", "white_label"]);
  });

  it("is unchanged when no overrides are passed (back-compat)", () => {
    expect(deriveEntitlements({ items: [seat] })).toEqual(["ai_copilot", "ai_forge", "ai_import"]);
  });
});
