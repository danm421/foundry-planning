// DELETE /api/clients/[id] — who may delete a whole client, and what it does.
//
// Only a firm admin of the firm that owns the client may delete it, and the
// delete moves the client's household to the Trash (the same lifecycle as
// deleting the household from the clients list); the Trash purge does the
// permanent delete later. Access that comes from a share — another firm's, or
// a colleague's — never qualifies, whatever its permission.
//
// Mocked at the db / auth seams (no database). The client gate is mocked with
// the outcome the real one gives each caller; its decisions are tested in
// src/lib/clients/__tests__/authz.test.ts.
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  deletes: [] as unknown[],
  access: null as null | { firmId: string; access: "own" | "shared"; permission: "edit" | "view" },
}));

vi.mock("@/db", () => {
  const tx = {
    delete: (table: unknown) => ({
      where: async () => {
        state.deletes.push(table);
      },
    }),
  };
  return {
    db: {
      ...tx,
      select: () => ({ from: () => ({ where: async () => [] }) }),
      transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    },
  };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => {
  const client = { id: "client-1", firmId: "firm_owner", crmHouseholdId: "hh-1" };
  return {
    requireClientAccess: vi.fn(async () => ({ client, ...state.access! })),
    requireClientEditAccess: vi.fn(async () => {
      if (state.access!.permission !== "edit") throw new Error("view only");
      return { client, firmId: state.access!.firmId, access: state.access!.access };
    }),
  };
});
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/crm/households", () => ({ softDeleteCrmHousehold: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordDelete: vi.fn(), recordUpdate: vi.fn() }));
vi.mock("@/lib/audit/snapshots/client", () => ({
  toClientSnapshot: () => ({}),
  CLIENT_FIELD_LABELS: {},
}));
vi.mock("@/lib/plaid/revoke", () => ({ revokePlaidTokens: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { softDeleteCrmHousehold } from "@/lib/crm/households";
import { DELETE } from "../route";

function callAs(
  caller: { userId: string; orgId: string; orgRole: string },
  access: NonNullable<typeof state.access>,
) {
  vi.mocked(auth).mockResolvedValue(caller as never);
  state.access = access;
  const req = new Request("http://test.local", { method: "DELETE" }) as unknown as
    import("next/server").NextRequest;
  return DELETE(req, { params: Promise.resolve({ id: "client-1" }) });
}

beforeEach(() => {
  state.deletes = [];
  vi.mocked(softDeleteCrmHousehold).mockReset();
});

describe("DELETE /api/clients/[id] — owning firm's admins only, via the Trash", () => {
  it.each(["org:admin", "org:member"])(
    "refuses a %s of another firm holding an edit share, and deletes nothing",
    async (orgRole) => {
      const res = await callAs(
        { userId: "user_other", orgId: "firm_other", orgRole },
        { firmId: "firm_owner", access: "shared", permission: "edit" },
      );

      expect(res.status).toBe(403);
      expect(state.deletes).toEqual([]);
      expect(softDeleteCrmHousehold).not.toHaveBeenCalled();
    },
  );

  it("refuses an own-firm admin whose access comes from a share", async () => {
    const res = await callAs(
      { userId: "user_colleague", orgId: "firm_owner", orgRole: "org:admin" },
      { firmId: "firm_owner", access: "shared", permission: "edit" },
    );

    expect(res.status).toBe(403);
    expect(state.deletes).toEqual([]);
    expect(softDeleteCrmHousehold).not.toHaveBeenCalled();
  });

  it("refuses an own-firm member who is not an admin, even the client's own advisor", async () => {
    const res = await callAs(
      { userId: "user_advisor", orgId: "firm_owner", orgRole: "org:member" },
      { firmId: "firm_owner", access: "own", permission: "edit" },
    );

    expect(res.status).toBe(403);
    expect(state.deletes).toEqual([]);
    expect(softDeleteCrmHousehold).not.toHaveBeenCalled();
  });

  it("lets an admin of the owning firm move the client's household to the Trash", async () => {
    const res = await callAs(
      { userId: "user_admin", orgId: "firm_owner", orgRole: "org:admin" },
      { firmId: "firm_owner", access: "own", permission: "edit" },
    );

    expect(res.status).toBe(200);
    expect(softDeleteCrmHousehold).toHaveBeenCalledWith("hh-1", "user_admin");
    // Nothing is hard-deleted here; the Trash purge does that later.
    expect(state.deletes).toEqual([]);
  });
});
