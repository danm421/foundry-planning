import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Auth mocks (real idiom, mirrors invite route) ---
const requireClientEditAccessMock = vi.fn();
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: (id: string) => requireClientEditAccessMock(id),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  authErrorResponse: () => undefined,
}));

// --- Clerk mock ---
const deleteUserMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "advisor-1", orgId: "firm-1" }),
  clerkClient: async () => ({
    users: { deleteUser: (id: string) => deleteUserMock(id) },
  }),
}));

// --- Binding layer mock ---
const getActiveBindingClerkUserIdMock = vi.fn();
const revokeBindingMock = vi.fn();
const revokeAllForUserMock = vi.fn();
vi.mock("@/lib/portal/bindings", () => ({
  getActiveBindingClerkUserId: (clientId: string) =>
    getActiveBindingClerkUserIdMock(clientId),
  revokeBinding: (args: unknown) => revokeBindingMock(args),
  revokeAllForUser: (clerkUserId: string) => revokeAllForUserMock(clerkUserId),
}));

// --- DB mock ---
const updateChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({ where: () => updateChain(vals) }),
    }),
  },
}));

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (args: unknown) => recordAuditMock(args) }));

import { POST } from "@/app/api/clients/[id]/portal/disable/route";

/** A POST with a JSON body. `undefined` sends no body at all — the old client. */
function req(body?: unknown) {
  return new Request("http://localhost/api/clients/client-1/portal/disable", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireClientEditAccessMock.mockReset();
  deleteUserMock.mockReset();
  updateChain.mockReset();
  recordAuditMock.mockReset();
  getActiveBindingClerkUserIdMock.mockReset();
  revokeBindingMock.mockReset();
  revokeAllForUserMock.mockReset();

  // Happy-path default: the household's login is known from portal_bindings.
  requireClientEditAccessMock.mockResolvedValue({
    firmId: "firm-1",
    access: "own",
    client: { id: "client-1", clerkUserId: "user_1" },
  });
  getActiveBindingClerkUserIdMock.mockResolvedValue("user_1");
  revokeBindingMock.mockResolvedValue(true);
  revokeAllForUserMock.mockResolvedValue(1);
});

describe("POST /api/clients/[id]/portal/disable — mode is required", () => {
  it("400s when mode is missing — never defaults to deleting a login", async () => {
    const res = await POST(req({}), ctx("client-1"));
    expect(res.status).toBe(400);
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(revokeBindingMock).not.toHaveBeenCalled();
  });

  it("400s when there is no body at all — the old client's request", async () => {
    const res = await POST(req(), ctx("client-1"));
    expect(res.status).toBe(400);
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(updateChain).not.toHaveBeenCalled();
  });

  it("400s on a mode it does not recognise", async () => {
    const res = await POST(req({ mode: "disable" }), ctx("client-1"));
    expect(res.status).toBe(400);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/clients/[id]/portal/disable — revoke", () => {
  it("revoke ends the binding and leaves the Clerk account alone", async () => {
    const res = await POST(req({ mode: "revoke" }), ctx("client-1"));
    expect(res.status).toBe(200);
    expect(revokeBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-1", endedBy: "advisor" }),
    );
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("does not clear the legacy column — the revoked row is what ends access", async () => {
    await POST(req({ mode: "revoke" }), ctx("client-1"));
    expect(updateChain).not.toHaveBeenCalled();
  });

  it("audits the advisor as the actor, through revokeBinding", async () => {
    await POST(req({ mode: "revoke" }), ctx("client-1"));
    expect(revokeBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_1", actorId: "advisor-1" }),
    );
  });

  it("says so honestly when there was no live binding to end", async () => {
    revokeBindingMock.mockResolvedValue(false);
    const res = await POST(req({ mode: "revoke" }), ctx("client-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: "revoke", ended: false });
  });

  it("does not call the binding layer when the household has no login at all", async () => {
    getActiveBindingClerkUserIdMock.mockResolvedValue(null);
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "client-1", clerkUserId: null },
    });

    const res = await POST(req({ mode: "revoke" }), ctx("client-1"));
    expect(res.status).toBe(200);
    expect(revokeBindingMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/clients/[id]/portal/disable — delete_login", () => {
  it("delete_login still deletes the Clerk account", async () => {
    const res = await POST(req({ mode: "delete_login" }), ctx("client-1"));
    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledWith("user_1");
  });

  it("delete_login revokes EVERY binding that login holds, not only this firm's", async () => {
    // The account is gone; leaving another firm's binding pointing at a deleted
    // Clerk user would be a row that can never resolve.
    await POST(req({ mode: "delete_login" }), ctx("client-1"));
    expect(revokeAllForUserMock).toHaveBeenCalledWith("user_1");
  });

  it("ends the bindings BEFORE the Clerk account goes away", async () => {
    const order: string[] = [];
    revokeAllForUserMock.mockImplementation(async () => {
      order.push("revokeAll");
      return 2;
    });
    deleteUserMock.mockImplementation(async () => {
      order.push("deleteUser");
    });

    await POST(req({ mode: "delete_login" }), ctx("client-1"));
    expect(order).toEqual(["revokeAll", "deleteUser"]);
  });

  it("still nulls clerk_user_id when Clerk's delete fails", async () => {
    deleteUserMock.mockRejectedValue(new Error("gone"));
    const res = await POST(req({ mode: "delete_login" }), ctx("client-1"));
    expect(res.status).toBe(200);
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: null, portalInvitedAt: null }),
    );
  });

  it("is a no-op for Clerk delete when no login is bound, but still nulls the legacy column", async () => {
    getActiveBindingClerkUserIdMock.mockResolvedValue(null);
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "client-1", clerkUserId: null },
    });

    const res = await POST(req({ mode: "delete_login" }), ctx("client-1"));
    expect(res.status).toBe(200);
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(revokeAllForUserMock).not.toHaveBeenCalled();
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: null }),
    );
  });

  it("records the destructive mode on the audit row", async () => {
    await POST(req({ mode: "delete_login" }), ctx("client-1"));
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.access.disabled",
        metadata: expect.objectContaining({ mode: "delete_login" }),
      }),
    );
  });
});

describe("POST /api/clients/[id]/portal/disable — which login it acts on", () => {
  it("resolves the login from portal_bindings, not the legacy column", async () => {
    // A client who ACCEPTED an access request has a binding row and no legacy
    // column at all — reading the column alone would revoke nothing.
    getActiveBindingClerkUserIdMock.mockResolvedValue("user_from_binding");
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "client-1", clerkUserId: null },
    });

    await POST(req({ mode: "revoke" }), ctx("client-1"));

    expect(getActiveBindingClerkUserIdMock).toHaveBeenCalledWith("client-1");
    expect(revokeBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_from_binding" }),
    );
  });

  it("falls back to the legacy column when the bindings table knows nothing", async () => {
    getActiveBindingClerkUserIdMock.mockResolvedValue(null);
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "client-1", clerkUserId: "user_legacy" },
    });

    await POST(req({ mode: "delete_login" }), ctx("client-1"));

    expect(deleteUserMock).toHaveBeenCalledWith("user_legacy");
  });

  it("prefers the binding over a STALE legacy column", async () => {
    getActiveBindingClerkUserIdMock.mockResolvedValue("user_current");
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "client-1", clerkUserId: "user_stale" },
    });

    await POST(req({ mode: "delete_login" }), ctx("client-1"));

    expect(deleteUserMock).toHaveBeenCalledWith("user_current");
    expect(deleteUserMock).not.toHaveBeenCalledWith("user_stale");
  });
});
