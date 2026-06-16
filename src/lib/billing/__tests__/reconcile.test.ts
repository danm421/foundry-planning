import { describe, it, expect } from "vitest";
import { diffReconciliation, type ReconcileInput } from "../reconcile";

const ok: ReconcileInput = {
  firmId: "org_1",
  stripe: {
    status: "active",
    items: [{ kind: "seat", addonKey: null, quantity: 3, removed: false }],
  },
  db: {
    status: "active",
    items: [{ kind: "seat", addonKey: null, quantity: 3, removed: false }],
  },
  clerk: {
    subscriptionStatus: "active",
    entitlements: ["ai_import"],
  },
};

describe("diffReconciliation", () => {
  it("returns no drift when all three sources agree (seat → ai_import)", () => {
    expect(diffReconciliation(ok)).toEqual([]);
  });

  it("flags status drift between Stripe and DB", () => {
    const input = { ...ok, db: { ...ok.db, status: "past_due" } };
    expect(diffReconciliation(input)).toEqual([
      {
        firmId: "org_1",
        field: "status",
        stripeValue: "active",
        dbValue: "past_due",
        clerkValue: "active",
      },
    ]);
  });

  it("flags status drift between Stripe and Clerk", () => {
    const input = {
      ...ok,
      clerk: { ...ok.clerk, subscriptionStatus: "past_due" },
    };
    const drift = diffReconciliation(input);
    expect(drift).toHaveLength(1);
    expect(drift[0].field).toBe("status");
  });

  it("flags entitlements drift when Clerk lacks the seat-included ai_import", () => {
    const input = { ...ok, clerk: { ...ok.clerk, entitlements: [] } };
    expect(diffReconciliation(input)).toEqual([
      {
        firmId: "org_1",
        field: "entitlements",
        stripeValue: ["ai_import"],
        clerkValue: [],
      },
    ]);
  });

  it("flags seat-quantity drift between Stripe and DB", () => {
    const input = {
      ...ok,
      db: {
        ...ok.db,
        items: [{ kind: "seat" as const, addonKey: null, quantity: 5, removed: false }],
      },
    };
    const drift = diffReconciliation(input);
    expect(drift.some((d) => d.field === "items")).toBe(true);
  });

  it("a removed addon does not add entitlements beyond the seat's ai_import", () => {
    const seat = { kind: "seat" as const, addonKey: null, quantity: 3, removed: false };
    const removedAddon = {
      kind: "addon" as const,
      addonKey: "white_label",
      quantity: 1,
      removed: true,
    };
    const input: ReconcileInput = {
      ...ok,
      stripe: { ...ok.stripe, items: [seat, removedAddon] },
      db: { ...ok.db, items: [seat, removedAddon] },
      clerk: { ...ok.clerk, entitlements: ["ai_import"] },
    };
    expect(diffReconciliation(input)).toEqual([]);
  });

  it("derives an active generic addon into the entitlements set", () => {
    const seat = { kind: "seat" as const, addonKey: null, quantity: 1, removed: false };
    const addon = {
      kind: "addon" as const,
      addonKey: "white_label",
      quantity: 1,
      removed: false,
    };
    expect(
      diffReconciliation({
        firmId: "org_1",
        stripe: { status: "active", items: [seat, addon] },
        db: { status: "active", items: [seat, addon] },
        clerk: { subscriptionStatus: "active", entitlements: ["ai_import"] },
      }),
    ).toEqual([
      {
        firmId: "org_1",
        field: "entitlements",
        stripeValue: ["ai_import", "white_label"],
        clerkValue: ["ai_import"],
      },
    ]);
  });
});

describe("diffReconciliation — entitlement overrides (no-clobber)", () => {
  it("includes an active grant in derived → no entitlements drift when Clerk already has it", () => {
    const input: ReconcileInput = {
      ...ok,
      clerk: { subscriptionStatus: "active", entitlements: ["ai_copilot", "ai_import"] },
      overrides: [{ entitlement: "ai_copilot", mode: "grant" }],
    };
    expect(diffReconciliation(input).find((d) => d.field === "entitlements")).toBeUndefined();
  });

  it("a grant appears in the entitlements drift stripeValue → auto-heal ADDS it (never strips)", () => {
    const input: ReconcileInput = {
      ...ok,
      clerk: { subscriptionStatus: "active", entitlements: ["ai_import"] }, // Clerk missing the grant
      overrides: [{ entitlement: "ai_copilot", mode: "grant" }],
    };
    const ent = diffReconciliation(input).find((d) => d.field === "entitlements");
    expect(ent?.stripeValue).toEqual(["ai_copilot", "ai_import"]); // heal writes THIS → grant survives
  });

  it("a revoke removes a seat-included key from derived", () => {
    const input: ReconcileInput = {
      ...ok,
      clerk: { subscriptionStatus: "active", entitlements: [] },
      overrides: [{ entitlement: "ai_import", mode: "revoke" }],
    };
    expect(diffReconciliation(input).find((d) => d.field === "entitlements")).toBeUndefined();
  });

  it("WITHOUT the override store, a manual Clerk key is flagged as drift (the clobber this prevents)", () => {
    const input: ReconcileInput = {
      ...ok,
      clerk: { subscriptionStatus: "active", entitlements: ["ai_copilot", "ai_import"] },
      // no overrides
    };
    const ent = diffReconciliation(input).find((d) => d.field === "entitlements");
    expect(ent?.stripeValue).toEqual(["ai_import"]); // heal would STRIP ai_copilot — the bug the store fixes
  });
});
