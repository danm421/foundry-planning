import { describe, it, expect, beforeEach, vi } from "vitest";
import { collapseActiveOverrides, setEntitlementOverride, type OverrideRow } from "../entitlements";

const h = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  overrideRows: [] as Array<Record<string, unknown>>,
  metadataWrites: [] as Array<{ id: string; p: unknown }>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/db/schema", () => ({
  opsEntitlementOverrides: { __t: "overrides" },
  subscriptions: { __t: "subscriptions" },
  subscriptionItems: { __t: "subscriptionItems" },
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserted.push(v);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: (t: { __t: string }) => {
        const rows = t.__t === "overrides" ? h.overrideRows : [];
        // chain supports `.where(...)` (terminal, awaited) AND `.where(...).orderBy(...)`
        const chain = {
          where: () => chain,
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => unknown) => resolve(rows),
        };
        return chain;
      },
    }),
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () =>
    Promise.resolve({
      organizations: {
        updateOrganizationMetadata: (id: string, p: unknown) => {
          h.metadataWrites.push({ id, p });
          return Promise.resolve();
        },
      },
    }),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (a: Record<string, unknown>) => {
    h.audits.push(a);
    return Promise.resolve();
  },
}));

const NOW = new Date("2026-06-15T00:00:00Z");
const row = (over: Partial<OverrideRow>): OverrideRow => ({
  entitlement: "ai_import",
  mode: "grant",
  reason: "r",
  setBy: "user_op",
  expiresAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  ...over,
});

describe("collapseActiveOverrides", () => {
  it("keeps the latest row per entitlement by createdAt", () => {
    const rows = [
      row({ mode: "grant", createdAt: new Date("2026-06-01T00:00:00Z") }),
      row({ mode: "revoke", createdAt: new Date("2026-06-10T00:00:00Z") }),
    ];
    expect(collapseActiveOverrides(rows, NOW)).toEqual([
      expect.objectContaining({ entitlement: "ai_import", mode: "revoke" }),
    ]);
  });

  it("drops expired overrides", () => {
    const rows = [row({ expiresAt: new Date("2026-06-10T00:00:00Z") })];
    expect(collapseActiveOverrides(rows, NOW)).toEqual([]);
  });

  it("treats a null expiry as active", () => {
    expect(collapseActiveOverrides([row({ expiresAt: null })], NOW)).toHaveLength(1);
  });

  it("treats a future expiry as active", () => {
    const rows = [row({ expiresAt: new Date("2026-12-31T00:00:00Z") })];
    expect(collapseActiveOverrides(rows, NOW)).toHaveLength(1);
  });

  it("collapses each entitlement independently, sorted by key", () => {
    const rows = [
      row({ entitlement: "white_label", mode: "grant" }),
      row({ entitlement: "ai_import", mode: "revoke" }),
    ];
    expect(collapseActiveOverrides(rows, NOW).map((o) => o.entitlement)).toEqual([
      "ai_import",
      "white_label",
    ]);
  });

  it("treats an expiry exactly at `now` as expired (<= boundary)", () => {
    const rows = [row({ expiresAt: new Date("2026-06-15T00:00:00Z") })]; // == NOW
    expect(collapseActiveOverrides(rows, NOW)).toEqual([]);
  });

  it("defensively skips rows with an invalid mode", () => {
    const rows = [row({ mode: "bogus", entitlement: "ai_import" })];
    expect(collapseActiveOverrides(rows, NOW)).toEqual([]);
  });
});

beforeEach(() => {
  h.inserted = [];
  h.overrideRows = [];
  h.metadataWrites = [];
  h.audits = [];
});

describe("setEntitlementOverride", () => {
  it("grants: inserts the row, writes the recomputed entitlements to Clerk, audits granted", async () => {
    h.overrideRows = [
      { entitlement: "ai_copilot", mode: "grant", reason: "comp", setBy: "user_op", expiresAt: null, createdAt: new Date("2026-06-15T00:00:00Z") },
    ];
    const result = await setEntitlementOverride({
      firmId: "org_1",
      entitlement: "ai_copilot",
      mode: "grant",
      reason: "comp",
      setBy: "user_op",
    });
    expect(h.inserted[0]).toMatchObject({ firmId: "org_1", entitlement: "ai_copilot", mode: "grant", reason: "comp", setBy: "user_op" });
    // No live sub → items []; base AI is always seeded, and the ai_copilot grant
    // is idempotent against it, so the effective set is the full base set.
    expect(result).toEqual(["ai_copilot", "ai_forge", "ai_import"]);
    expect(h.metadataWrites[0]).toEqual({ id: "org_1", p: { publicMetadata: { entitlements: ["ai_copilot", "ai_forge", "ai_import"] } } });
    expect(h.audits[0]).toMatchObject({
      action: "ops.entitlement.granted",
      actorId: "user_op",
      firmId: "org_1",
      resourceType: "firm",
      resourceId: "org_1",
      metadata: expect.objectContaining({ entitlement: "ai_copilot", reason: "comp" }),
    });
  });

  it("revokes: audits revoked and writes the recomputed set", async () => {
    h.overrideRows = [
      { entitlement: "ai_import", mode: "revoke", reason: "abuse", setBy: "user_op", expiresAt: null, createdAt: new Date("2026-06-15T00:00:00Z") },
    ];
    const result = await setEntitlementOverride({
      firmId: "org_1",
      entitlement: "ai_import",
      mode: "revoke",
      reason: "abuse",
      setBy: "user_op",
    });
    // Base AI is seeded even with no items; the revoke strips ai_import, leaving
    // the rest of the base set — the ops per-firm kill switch on a base key.
    expect(result).toEqual(["ai_copilot", "ai_forge"]);
    expect(h.audits[0]).toMatchObject({ action: "ops.entitlement.revoked" });
  });
});
