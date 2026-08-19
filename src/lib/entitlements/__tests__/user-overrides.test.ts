import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

/**
 * `eq`/`and` return row PREDICATES instead of Drizzle SQL objects, and the
 * `@/db` fake below actually applies them. Without this the `where` argument
 * was thrown away and every test in this file still passed with the firmId
 * predicate DELETED — which is the entire justification for firm_id being in
 * the key. Asserting on Drizzle's SQL-object shape would be brittle; this
 * tests the DECISION instead.
 */
type Pred = (r: Record<string, unknown>) => boolean;
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown): Pred => (r) => r[col] === val,
  and:
    (...preds: Pred[]): Pred =>
    (r) => preds.every((p) => p(r)),
}));

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
        where: (pred: Pred) => ({
          orderBy: () => Promise.resolve(h.rows.filter(pred)),
        }),
      }),
    }),
  },
}));

import {
  getActiveUserOverrides,
  getActiveUserOverridesForFirm,
} from "../user-overrides";

const PAST = new Date("2020-01-01T00:00:00Z");
/**
 * Every row carries both spellings of its two key columns: snake_case, which is
 * what the `@/db/schema` fake names them and therefore what the WHERE
 * predicates match on, and camelCase, which is what the code reads back.
 */
const row = (over: Record<string, unknown>) => {
  const r = {
    firmId: "org_firm",
    clerkUserId: "u_advisor",
    entitlement: "client_portal",
    mode: "grant",
    reason: "pilot",
    setBy: "u_ops",
    expiresAt: null,
    createdAt: new Date("2026-08-19T00:00:00Z"),
    ...over,
  };
  return { ...r, firm_id: r.firmId, clerk_user_id: r.clerkUserId };
};

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

  it("keeps the newest row even when the older one comes LAST in the array", async () => {
    // The reverse of the case above: the collapse must decide on createdAt, not
    // on array position, in both directions.
    h.rows = [
      row({ mode: "revoke", createdAt: new Date("2026-08-19T00:00:00Z") }),
      row({ mode: "grant", createdAt: new Date("2026-08-01T00:00:00Z") }),
    ];
    const out = await getActiveUserOverrides("org_firm", "u_advisor");
    expect(out).toHaveLength(1);
    expect(out[0].mode).toBe("revoke");
  });

  it("does not surface the same user's override from ANOTHER firm", async () => {
    // A grant never follows a user across firms — the reason firm_id is in the key.
    h.rows = [row({ firmId: "org_other" })];
    expect(await getActiveUserOverrides("org_firm", "u_advisor")).toEqual([]);
  });

  it("does not surface ANOTHER user's override from the same firm", async () => {
    h.rows = [row({ clerkUserId: "u_other" })];
    expect(await getActiveUserOverrides("org_firm", "u_advisor")).toEqual([]);
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

  it("never spills another firm's overrides into this firm's console", async () => {
    h.rows = [row({ clerkUserId: "u_a" }), row({ clerkUserId: "u_b", firmId: "org_other" })];
    const byUser = await getActiveUserOverridesForFirm("org_firm");
    expect(byUser.get("u_a")?.[0].mode).toBe("grant");
    expect(byUser.has("u_b")).toBe(false);
  });

  it("short-circuits to an empty map without querying when firmId is blank", async () => {
    h.rows = [row({ clerkUserId: "u_a" })];
    expect(await getActiveUserOverridesForFirm("")).toEqual(new Map());
  });
});
