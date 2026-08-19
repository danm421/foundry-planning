import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/db/schema", () => ({
  opsUserEntitlementOverrides: {
    firmId: "firm_id",
    clerkUserId: "clerk_user_id",
    entitlement: "entitlement",
    mode: "mode",
    reason: "reason",
    setBy: "set_by",
    expiresAt: "expires_at",
    createdAt: "created_at",
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve(h.rows) }),
      }),
    }),
  },
}));

import {
  getActiveUserOverrides,
  getActiveUserOverridesForFirm,
} from "../user-overrides";

const PAST = new Date("2020-01-01T00:00:00Z");
const row = (over: Record<string, unknown>) => ({
  clerkUserId: "u_advisor",
  entitlement: "client_portal",
  mode: "grant",
  reason: "pilot",
  setBy: "u_ops",
  expiresAt: null,
  createdAt: new Date("2026-08-19T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  h.rows = [];
});

describe("getActiveUserOverrides", () => {
  it("returns the collapsed active overrides for one user", async () => {
    h.rows = [row({})];
    const out = await getActiveUserOverrides("org_firm", "u_advisor");
    expect(out).toEqual([
      expect.objectContaining({ entitlement: "client_portal", mode: "grant" }),
    ]);
  });

  it("drops an expired row", async () => {
    h.rows = [row({ expiresAt: PAST })];
    expect(await getActiveUserOverrides("org_firm", "u_advisor")).toEqual([]);
  });

  it("keeps only the newest row per entitlement", async () => {
    h.rows = [
      row({ mode: "grant", createdAt: new Date("2026-08-01T00:00:00Z") }),
      row({ mode: "revoke", createdAt: new Date("2026-08-19T00:00:00Z") }),
    ];
    const out = await getActiveUserOverrides("org_firm", "u_advisor");
    expect(out).toHaveLength(1);
    expect(out[0].mode).toBe("revoke");
  });

  it("short-circuits to [] without querying when either key is blank", async () => {
    h.rows = [row({})];
    expect(await getActiveUserOverrides("", "u_advisor")).toEqual([]);
    expect(await getActiveUserOverrides("org_firm", "")).toEqual([]);
  });
});

describe("getActiveUserOverridesForFirm", () => {
  it("groups by user in a single query", async () => {
    h.rows = [
      row({ clerkUserId: "u_a" }),
      row({ clerkUserId: "u_b", mode: "revoke" }),
    ];
    const byUser = await getActiveUserOverridesForFirm("org_firm");
    expect(byUser.get("u_a")?.[0].mode).toBe("grant");
    expect(byUser.get("u_b")?.[0].mode).toBe("revoke");
  });

  it("omits a user whose only row has expired", async () => {
    h.rows = [row({ clerkUserId: "u_a", expiresAt: PAST })];
    const byUser = await getActiveUserOverridesForFirm("org_firm");
    expect(byUser.get("u_a")).toEqual([]);
  });
});
