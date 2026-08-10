import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/db/schema", () => ({ opsAdmins: { clerkUserId: "clerk_user_id" } }));

vi.mock("@/db", () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => Promise.resolve(h.rows),
        limit: () => Promise.resolve(h.rows),
        then: (resolve: (v: unknown) => unknown) => resolve(h.rows),
      };
      return chain;
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserted.push(v);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        h.updated.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (a: Record<string, unknown>) => {
    h.audits.push(a);
    return Promise.resolve();
  },
}));

import {
  listOpsAdmins,
  addOpsAdmin,
  updateOpsAdmin,
  OpsAdminError,
  SELF_EDIT_ERROR,
} from "../ops-admins";

const row = (over: Record<string, unknown> = {}) => ({
  clerkUserId: "user_target",
  email: "target@foundry",
  role: "support",
  disabledAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  h.rows = [];
  h.inserted = [];
  h.updated = [];
  h.audits = [];
});

describe("listOpsAdmins", () => {
  it("maps rows through, preserving role and disabled state", async () => {
    h.rows = [row({ role: "ops", disabledAt: new Date("2026-07-01T00:00:00Z") })];
    expect(await listOpsAdmins()).toEqual([
      expect.objectContaining({
        clerkUserId: "user_target",
        email: "target@foundry",
        role: "ops",
        disabledAt: new Date("2026-07-01T00:00:00Z"),
      }),
    ]);
  });

  it("surfaces an unrecognized role rather than silently coercing it", async () => {
    // ops-auth fails such a row closed; the console must still SHOW it so a
    // superadmin can see why that person has no access, and fix it.
    h.rows = [row({ role: "owner" })];
    expect((await listOpsAdmins())[0]).toMatchObject({ role: "owner" });
  });
});

describe("addOpsAdmin", () => {
  it("inserts the row and audits the add", async () => {
    h.rows = []; // no existing row for this user
    await addOpsAdmin({
      clerkUserId: "user_new",
      email: "new@foundry",
      role: "support",
      actorId: "user_super",
    });
    expect(h.inserted[0]).toMatchObject({
      clerkUserId: "user_new",
      email: "new@foundry",
      role: "support",
      disabledAt: null,
    });
    expect(h.audits[0]).toMatchObject({
      action: "ops.admin.added",
      actorId: "user_super",
      resourceType: "ops_admin",
      resourceId: "user_new",
      metadata: expect.objectContaining({ role: "support", email: "new@foundry" }),
    });
  });

  it("refuses a duplicate instead of silently overwriting the existing role", async () => {
    h.rows = [row({ clerkUserId: "user_new", role: "superadmin" })];
    await expect(
      addOpsAdmin({
        clerkUserId: "user_new",
        email: "new@foundry",
        role: "support",
        actorId: "user_super",
      }),
    ).rejects.toBeInstanceOf(OpsAdminError);
    expect(h.inserted).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("refuses to add the actor themselves", async () => {
    h.rows = [];
    await expect(
      addOpsAdmin({
        clerkUserId: "user_super",
        email: "super@foundry",
        role: "superadmin",
        actorId: "user_super",
      }),
    ).rejects.toThrow(SELF_EDIT_ERROR);
    expect(h.inserted).toEqual([]);
  });
});

describe("updateOpsAdmin", () => {
  it("writes the new role and clears disabled_at when enabling", async () => {
    h.rows = [row({ role: "support", disabledAt: new Date("2026-07-01T00:00:00Z") })];
    await updateOpsAdmin({
      clerkUserId: "user_target",
      role: "ops",
      disabled: false,
      actorId: "user_super",
    });
    expect(h.updated[0]).toMatchObject({ role: "ops", disabledAt: null });
    expect(h.audits[0]).toMatchObject({
      action: "ops.admin.updated",
      actorId: "user_super",
      resourceId: "user_target",
      metadata: expect.objectContaining({ role: "ops", disabled: false }),
    });
  });

  it("stamps disabled_at when disabling", async () => {
    h.rows = [row()];
    await updateOpsAdmin({
      clerkUserId: "user_target",
      role: "support",
      disabled: true,
      actorId: "user_super",
    });
    expect(h.updated[0].disabledAt).toBeInstanceOf(Date);
    expect(h.audits[0]).toMatchObject({ metadata: expect.objectContaining({ disabled: true }) });
  });

  it("preserves the existing disabled_at instead of re-stamping an already-disabled row", async () => {
    const was = new Date("2026-07-01T00:00:00Z");
    h.rows = [row({ disabledAt: was })];
    await updateOpsAdmin({
      clerkUserId: "user_target",
      role: "ops",
      disabled: true,
      actorId: "user_super",
    });
    expect(h.updated[0].disabledAt).toEqual(was);
  });

  // The lockout guard. The actor is, by definition, an active superadmin (the
  // page requires it) and cannot edit themselves — so every permitted change
  // leaves at least one active superadmin standing.
  it("refuses a self-edit, so a superadmin cannot demote or disable themselves", async () => {
    h.rows = [row({ clerkUserId: "user_super", role: "superadmin" })];
    await expect(
      updateOpsAdmin({
        clerkUserId: "user_super",
        role: "support",
        disabled: false,
        actorId: "user_super",
      }),
    ).rejects.toThrow(SELF_EDIT_ERROR);
    expect(h.updated).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("refuses a self-disable", async () => {
    h.rows = [row({ clerkUserId: "user_super", role: "superadmin" })];
    await expect(
      updateOpsAdmin({
        clerkUserId: "user_super",
        role: "superadmin",
        disabled: true,
        actorId: "user_super",
      }),
    ).rejects.toBeInstanceOf(OpsAdminError);
    expect(h.updated).toEqual([]);
  });

  it("refuses to update a row that does not exist", async () => {
    h.rows = [];
    await expect(
      updateOpsAdmin({
        clerkUserId: "user_ghost",
        role: "ops",
        disabled: false,
        actorId: "user_super",
      }),
    ).rejects.toBeInstanceOf(OpsAdminError);
    expect(h.updated).toEqual([]);
  });
});
