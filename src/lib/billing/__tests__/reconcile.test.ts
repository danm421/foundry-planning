import { describe, it, expect } from "vitest";
import { diffReconciliation, type ReconcileInput } from "../reconcile";

const ok: ReconcileInput = {
  firmId: "org_1",
  stripe: {
    status: "active",
    items: [
      { kind: "seat", addonKey: null, quantity: 3, removed: false },
      { kind: "addon", addonKey: "ai_import", quantity: 1, removed: false },
    ],
  },
  db: {
    status: "active",
    items: [
      { kind: "seat", addonKey: null, quantity: 3, removed: false },
      { kind: "addon", addonKey: "ai_import", quantity: 1, removed: false },
    ],
  },
  clerk: {
    subscriptionStatus: "active",
    entitlements: ["ai_import"],
  },
};

describe("diffReconciliation", () => {
  it("returns no drift when all three sources agree", () => {
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

  it("flags entitlements drift between derived and Clerk", () => {
    const input = { ...ok, clerk: { ...ok.clerk, entitlements: [] } };
    const drift = diffReconciliation(input);
    expect(drift).toHaveLength(1);
    expect(drift[0].field).toBe("entitlements");
  });

  it("flags seat-quantity drift between Stripe and DB", () => {
    const input = {
      ...ok,
      db: {
        ...ok.db,
        items: [
          { kind: "seat" as const, addonKey: null, quantity: 5, removed: false },
          { kind: "addon" as const, addonKey: "ai_import", quantity: 1, removed: false },
        ],
      },
    };
    const drift = diffReconciliation(input);
    expect(drift.some((d) => d.field === "items")).toBe(true);
  });

  it("treats removed items as not present in the entitlement comparison", () => {
    const input = {
      ...ok,
      stripe: {
        ...ok.stripe,
        items: [
          { kind: "seat" as const, addonKey: null, quantity: 3, removed: false },
          { kind: "addon" as const, addonKey: "ai_import", quantity: 1, removed: true },
        ],
      },
      clerk: { ...ok.clerk, entitlements: [] },
    };
    expect(diffReconciliation(input)).toEqual([]);
  });
});
