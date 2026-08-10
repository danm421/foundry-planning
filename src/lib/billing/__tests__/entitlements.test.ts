import { describe, it, expect } from "vitest";
import {
  deriveEntitlements,
  BASE_ENTITLEMENTS,
  CLIENT_PORTAL_ENTITLEMENT,
  hasClientPortalEntitlement,
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

// The always-on base AI set, sorted, reused across expectations. AI ships with
// every org regardless of subscription — the derivation seeds this set first.
const BASE = ["ai_copilot", "ai_forge", "ai_import"];

describe("deriveEntitlements — base AI is always granted", () => {
  it("grants the base AI set even with no items (every org gets AI)", () => {
    expect(deriveEntitlements({ items: [] })).toEqual(BASE);
  });

  it("grants the base AI set for an active seat", () => {
    expect(deriveEntitlements({ items: [seat] })).toEqual(BASE);
  });

  it("still grants base AI when the only seat item is removed (AI is not seat-gated)", () => {
    expect(deriveEntitlements({ items: [{ ...seat, removed: true }] })).toEqual(BASE);
  });

  it("BASE_ENTITLEMENTS is exactly the AI set", () => {
    expect([...BASE_ENTITLEMENTS].sort()).toEqual(BASE);
  });
});

describe("deriveEntitlements — addons union on top of base", () => {
  it("unions the base AI set with a generic addon, sorted", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ addonKey: "white_label" })] }),
    ).toEqual(["ai_copilot", "ai_forge", "ai_import", "white_label"]);
  });

  it("grants a generic addon on top of base even without a seat", () => {
    expect(
      deriveEntitlements({ items: [mkAddon({ addonKey: "white_label" })] }),
    ).toEqual(["ai_copilot", "ai_forge", "ai_import", "white_label"]);
  });

  it("excludes removed addons (base remains)", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ removed: true })] }),
    ).toEqual(BASE);
  });

  it("excludes addon items with a null addonKey (defensive; base remains)", () => {
    expect(
      deriveEntitlements({
        items: [{ kind: "addon", addonKey: null, removed: false }],
      }),
    ).toEqual(BASE);
  });

  it("dedupes when an addon key duplicates a base entitlement", () => {
    expect(
      deriveEntitlements({ items: [seat, mkAddon({ addonKey: "ai_import" })] }),
    ).toEqual(BASE);
  });
});

describe("deriveEntitlements — override union (final step)", () => {
  it("a grant of a base key is idempotent (base already includes it)", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "ai_copilot", mode: "grant" }];
    expect(deriveEntitlements({ items: [], overrides })).toEqual(BASE);
  });

  it("a grant adds a non-base key the subscription does not imply", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "white_label", mode: "grant" }];
    expect(deriveEntitlements({ items: [], overrides })).toEqual([
      "ai_copilot",
      "ai_forge",
      "ai_import",
      "white_label",
    ]);
  });

  it("a revoke strips a base key — the ops per-firm kill switch", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "ai_import", mode: "revoke" }];
    expect(deriveEntitlements({ items: [], overrides })).toEqual(["ai_copilot", "ai_forge"]);
  });

  it("applies overrides in array order — later wins (revoke after grant strips the base key)", () => {
    const overrides: EntitlementOverride[] = [
      { entitlement: "ai_import", mode: "grant" },
      { entitlement: "ai_import", mode: "revoke" },
    ];
    expect(deriveEntitlements({ items: [], overrides })).toEqual(["ai_copilot", "ai_forge"]);
  });

  it("keeps output sorted after applying a grant", () => {
    const overrides: EntitlementOverride[] = [{ entitlement: "white_label", mode: "grant" }];
    expect(deriveEntitlements({ items: [seat], overrides })).toEqual([
      "ai_copilot",
      "ai_forge",
      "ai_import",
      "white_label",
    ]);
  });

  it("is the base set when no overrides are passed (back-compat)", () => {
    expect(deriveEntitlements({ items: [seat] })).toEqual(BASE);
  });
});

describe("client portal — off for every firm until ops grants it", () => {
  it("is absent from the base set, so it is never seeded", () => {
    // Literal membership, not a loop over BASE_ENTITLEMENTS: this is the whole
    // "off by default" property, so it must fail if the key is ever added there.
    expect([...BASE_ENTITLEMENTS]).not.toContain(CLIENT_PORTAL_ENTITLEMENT);
  });

  it("a seat does not grant it", () => {
    expect(deriveEntitlements({ items: [seat] })).not.toContain(CLIENT_PORTAL_ENTITLEMENT);
  });

  it("an ops grant override is what turns it on for one firm", () => {
    const overrides: EntitlementOverride[] = [
      { entitlement: CLIENT_PORTAL_ENTITLEMENT, mode: "grant" },
    ];
    expect(deriveEntitlements({ items: [seat], overrides })).toEqual([
      "ai_copilot",
      "ai_forge",
      "ai_import",
      "client_portal",
    ]);
  });

  it("a later revoke takes it back off", () => {
    const overrides: EntitlementOverride[] = [
      { entitlement: CLIENT_PORTAL_ENTITLEMENT, mode: "grant" },
      { entitlement: CLIENT_PORTAL_ENTITLEMENT, mode: "revoke" },
    ];
    expect(deriveEntitlements({ items: [seat], overrides })).toEqual(BASE);
  });
});

describe("hasClientPortalEntitlement", () => {
  it("is true only when the key is present", () => {
    expect(hasClientPortalEntitlement(["ai_import", "client_portal"])).toBe(true);
  });

  it("fails closed on an org without the key", () => {
    expect(hasClientPortalEntitlement(["ai_import", "ai_forge"])).toBe(false);
  });

  it("fails closed on missing or stale Clerk metadata", () => {
    expect(hasClientPortalEntitlement(null)).toBe(false);
    expect(hasClientPortalEntitlement(undefined)).toBe(false);
    expect(hasClientPortalEntitlement([])).toBe(false);
  });
});
