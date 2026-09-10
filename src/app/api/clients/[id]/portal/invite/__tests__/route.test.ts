import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClerkAPIResponseError } from "@clerk/nextjs/errors";

// --- Auth mocks (real idiom, not @/lib/authz-clients) ---
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
  // The real authErrorResponse (see the @/lib/authz mock) instanceof-checks it.
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

// The household's advisor is advisor-2 while the CALLER is advisor-1 — the two
// gates below must be asked about different people, so they must not be
// interchangeable in a test either.
const h = vi.hoisted(() => ({ client: { id: "c1", advisorId: "advisor-2" } }));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: async () => ({
    firmId: "firm-1",
    access: "own",
    client: h.client,
  }),
}));

// Real ForbiddenError + authErrorResponse so the 403 path under test is the
// route's actual error mapping, not a stub of it.
const portalEntitlementMock = vi.fn();
const portalForAdvisorMock = vi.fn();
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireActiveSubscriptionForFirm: async () => {},
    requireClientPortalEntitlement: async () => portalEntitlementMock(),
    requireClientPortalForAdvisor: async (firmId: string, advisorId: string) =>
      portalForAdvisorMock(firmId, advisorId),
  };
});

vi.mock("@/lib/clients/cross-firm-audit", () => ({
  crossFirmAuditMeta: (..._a: unknown[]) => ({}),
}));

// --- Rate-limit mock ---
const checkLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkPortalInviteRateLimit: (k: string) => checkLimitMock(k),
}));

// --- The request branch's collaborators (Task 8) ---
// vi.hoisted because the bindings factory below references its mock at
// factory-execution time, which runs before a plain `const` is initialised.
const {
  getUserListMock,
  createPendingBindingMock,
  deletePendingBindingMock,
  sendAccessRequestMock,
} = vi.hoisted(() => ({
  getUserListMock: vi.fn(),
  createPendingBindingMock: vi.fn(),
  deletePendingBindingMock: vi.fn(),
  sendAccessRequestMock: vi.fn(),
}));
vi.mock("@/lib/portal/bindings", () => ({
  createPendingBinding: createPendingBindingMock,
  deletePendingBinding: deletePendingBindingMock,
}));
vi.mock("@/lib/clients/send-portal-access-request", () => ({
  sendPortalAccessRequest: sendAccessRequestMock,
}));

// --- Clerk mock ---
const createInvitationMock = vi.fn();
const revokeInvitationMock = vi.fn();
const getInvitationListMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "advisor-1", orgId: "firm-1" }),
  clerkClient: async () => ({
    invitations: {
      createInvitation: (args: unknown) => createInvitationMock(args),
      revokeInvitation: (id: string) => revokeInvitationMock(id),
      getInvitationList: (args: unknown) => getInvitationListMock(args),
    },
    users: {
      getUserList: (args: unknown) => getUserListMock(args),
    },
  }),
}));

// --- DB mock ---
const updateMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({
        where: () => updateMock(vals),
      }),
    }),
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST, DELETE } from "@/app/api/clients/[id]/portal/invite/route";
import { ForbiddenError } from "@/lib/authz";

beforeEach(() => {
  checkLimitMock.mockReset();
  createInvitationMock.mockReset();
  revokeInvitationMock.mockReset();
  getInvitationListMock.mockReset();
  updateMock.mockReset();
  portalEntitlementMock.mockReset();
  portalForAdvisorMock.mockReset();
  createPendingBindingMock.mockReset();
  deletePendingBindingMock.mockReset();
  sendAccessRequestMock.mockReset();
  getUserListMock.mockReset();
  // Default: the email has no Foundry account, so every pre-existing test
  // keeps taking the Clerk-invitation path it was written against.
  getUserListMock.mockResolvedValue({ data: [], totalCount: 0 });
  h.client = { id: "c1", advisorId: "advisor-2" };
});

function ctx() {
  return { params: Promise.resolve({ id: "c1" }) };
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/clients/c1/portal/invite", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/clients/[id]/portal/invite", () => {
  it("rejects when rate-limited", async () => {
    checkLimitMock.mockResolvedValue({ allowed: false, reason: "exceeded" });
    const res = await POST(postReq({ email: "client@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(429);
  });

  it("creates Clerk invitation with clientId metadata and stamps portalInvitedAt", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    createInvitationMock.mockResolvedValue({ id: "inv_1" });
    const res = await POST(postReq({ email: "client@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(createInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: "client@example.com",
        publicMetadata: { clientId: "c1" },
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ portalInvitedAt: expect.any(Date) }),
    );
  });

  it("returns 409 with a clear message when the email already has an account", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    createInvitationMock.mockRejectedValue(
      new ClerkAPIResponseError("Unprocessable Entity", {
        status: 422,
        data: [
          { code: "form_identifier_exists", message: "That email address is taken." },
        ],
      }),
    );
    const res = await POST(postReq({ email: "taken@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/couldn't send an invitation/i);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 409 with a distinct message when an invitation is already pending", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    createInvitationMock.mockRejectedValue(
      new ClerkAPIResponseError("Bad Request", {
        status: 400,
        data: [
          { code: "duplicate_record", message: "There is already a pending invitation." },
        ],
      }),
    );
    const res = await POST(postReq({ email: "pending@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already pending/i);
  });

  it("403s without sending an invite when the firm lacks the client_portal entitlement", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    portalEntitlementMock.mockImplementation(() => {
      throw new ForbiddenError("Client portal is not enabled");
    });
    const res = await POST(postReq({ email: "client@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(403);
    expect(createInvitationMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("asks the portal question about the HOUSEHOLD'S advisor, not the sender", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    createInvitationMock.mockResolvedValue({ id: "inv_1" });
    const res = await POST(postReq({ email: "client@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    // advisor-2 owns the household; advisor-1 is the caller. Sign-in resolves
    // against clients.advisor_id, so advisor-2 is the one who must be entitled.
    expect(portalForAdvisorMock).toHaveBeenCalledWith("firm-1", "advisor-2");
  });

  it("403s without sending an invite when the household's advisor is revoked, though the sender is entitled", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    // The sender passes; only the owning advisor is revoked. Without the second
    // gate this mints an invite whose client then 403s at sign-in forever.
    portalForAdvisorMock.mockImplementation(() => {
      throw new ForbiddenError("Client portal is not enabled");
    });
    const res = await POST(postReq({ email: "client@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(403);
    expect(portalEntitlementMock).toHaveBeenCalled();
    expect(createInvitationMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("still returns 500 for a non-Clerk failure", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    createInvitationMock.mockRejectedValue(new Error("network down"));
    const res = await POST(postReq({ email: "client@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(500);
  });
});

/**
 * The request branch: an email that ALREADY has a Foundry account can't be
 * invited (Clerk refuses), so the advisor asks the account holder instead.
 * Only that person can create the binding.
 */
describe("POST /api/clients/[id]/portal/invite — existing account", () => {
  beforeEach(() => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    getUserListMock.mockResolvedValue({
      data: [{ id: "user_existing" }],
      totalCount: 1,
    });
  });

  it("sends an access request instead of a 409 when the email already has an account", async () => {
    createPendingBindingMock.mockResolvedValue({ ok: true, bindingId: "binding-1" });
    sendAccessRequestMock.mockResolvedValue({ delivered: true });

    const res = await POST(postReq({ email: "taken@example.com" }), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: "requested" });
    // The row names the login Clerk matched and the advisor who asked — it is
    // that person's decision to accept, and the audit trail says who asked.
    expect(createPendingBindingMock).toHaveBeenCalledWith({
      clientId: "c1",
      clerkUserId: "user_existing",
      requestedBy: "advisor-1",
    });
    // The Clerk invitation must NOT be attempted for an existing account, and
    // nothing may stamp the household as invited when it was only asked.
    expect(createInvitationMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("still uses the Clerk invitation for an email with no account", async () => {
    getUserListMock.mockResolvedValue({ data: [], totalCount: 0 });
    createInvitationMock.mockResolvedValue({ id: "inv_1" });

    const res = await POST(postReq({ email: "new@example.com" }), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      mode: "invited",
      invitationId: "inv_1",
    });
    expect(createPendingBindingMock).not.toHaveBeenCalled();
    expect(sendAccessRequestMock).not.toHaveBeenCalled();
  });

  it("409s with a plain reason when a live binding already exists", async () => {
    createPendingBindingMock.mockResolvedValue({ ok: false, reason: "already_live" });

    const res = await POST(postReq({ email: "taken@example.com" }), ctx());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already has access|already been asked/i);
    // No row was written, so no mail may go out.
    expect(sendAccessRequestMock).not.toHaveBeenCalled();
  });

  it("409s during the decline cooldown", async () => {
    createPendingBindingMock.mockResolvedValue({ ok: false, reason: "recently_declined" });

    const res = await POST(postReq({ email: "taken@example.com" }), ctx());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/declined/i);
  });

  it("reports a failed send rather than claiming the client was asked", async () => {
    createPendingBindingMock.mockResolvedValue({ ok: true, bindingId: "binding-1" });
    sendAccessRequestMock.mockResolvedValue({ delivered: false, reason: "send_failed" });

    const res = await POST(postReq({ email: "taken@example.com" }), ctx());

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/couldn't send/i);
    // Nothing left the building, so nothing was requested: the row goes too —
    // scoped to THIS household, never by a bare binding id.
    expect(deletePendingBindingMock).toHaveBeenCalledWith("binding-1", "c1");
  });

  it("undoes the pending row on a failed send, so the advisor's retry is not refused", async () => {
    // A stand-in for the pending-row table, so this test exercises the real
    // one-live-row-per-(household, login) rule rather than a canned answer.
    const rows = new Map<string, string>();
    let seq = 0;
    createPendingBindingMock.mockImplementation(
      async (args: { clientId: string; clerkUserId: string }) => {
        const key = `${args.clientId}:${args.clerkUserId}`;
        if ([...rows.values()].includes(key)) {
          return { ok: false, reason: "already_live" };
        }
        const bindingId = `binding-${++seq}`;
        rows.set(bindingId, key);
        return { ok: true, bindingId };
      },
    );
    // The stand-in enforces the household scope too, so a route that deleted
    // by a bare id (or the wrong client) would leave the row and fail the retry.
    deletePendingBindingMock.mockImplementation(async (id: string, clientId: string) => {
      if (rows.get(id)?.split(":")[0] !== clientId) return false;
      return rows.delete(id);
    });

    sendAccessRequestMock.mockResolvedValue({ delivered: false, reason: "send_failed" });
    const failed = await POST(postReq({ email: "taken@example.com" }), ctx());
    expect(failed.status).toBe(502);

    // The retry: the undone row leaves nothing for already_live to refuse.
    // Left behind, it would 409 every retry for the full 14-day request TTL.
    sendAccessRequestMock.mockResolvedValue({ delivered: true });
    const retry = await POST(postReq({ email: "taken@example.com" }), ctx());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, mode: "requested" });

    // Control: the row a SUCCESSFUL send leaves behind IS refused, so the 200
    // above is the undo working rather than the guard being toothless.
    const again = await POST(postReq({ email: "taken@example.com" }), ctx());
    expect(again.status).toBe(409);
  });

  it("does not reveal which other firms the account is bound to", async () => {
    createPendingBindingMock.mockResolvedValue({ ok: true, bindingId: "binding-1" });
    sendAccessRequestMock.mockResolvedValue({ delivered: true });

    const res = await POST(postReq({ email: "taken@example.com" }), ctx());
    const body = JSON.stringify(await res.json());

    // Pinned first: an error body would satisfy the leak check vacuously.
    expect(res.status).toBe(200);
    expect(body).not.toMatch(/firm|household|other/i);
  });
});

describe("DELETE /api/clients/[id]/portal/invite", () => {
  it("revokes only the invitation whose metadata.clientId === clientId", async () => {
    getInvitationListMock.mockResolvedValue({
      data: [
        { id: "inv_keep", status: "pending", publicMetadata: { clientId: "other" } },
        { id: "inv_drop", status: "pending", publicMetadata: { clientId: "c1" } },
      ],
    });
    const res = await DELETE(
      new Request("http://localhost/api/clients/c1/portal/invite", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(res.status).toBe(200);
    expect(revokeInvitationMock).toHaveBeenCalledWith("inv_drop");
    expect(revokeInvitationMock).not.toHaveBeenCalledWith("inv_keep");
  });
});
