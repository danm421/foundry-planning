import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Auth mocks (mirrors the invite route's test) ---
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

// The household's advisor is advisor-2 while the CALLER is advisor-1 — the
// portal gate below must be asked about the household's advisor, since that is
// who sign-in resolves against.
const h = vi.hoisted(() => ({
  client: { id: "c1", advisorId: "advisor-2", clerkUserId: "user_xyz" } as {
    id: string;
    advisorId: string;
    clerkUserId: string | null;
  },
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: async () => ({
    firmId: "firm-1",
    access: "own",
    client: h.client,
  }),
}));

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
  crossFirmAuditMeta: () => ({}),
}));

const checkLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkPortalInviteRateLimit: (k: string) => checkLimitMock(k),
}));

// --- Clerk mock ---
const getUserMock = vi.fn();
const disableMfaMock = vi.fn();
const getSessionListMock = vi.fn();
const revokeSessionMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "advisor-1", orgId: "firm-1" }),
  clerkClient: async () => ({
    users: {
      getUser: (id: string) => getUserMock(id),
      disableUserMFA: (id: string) => disableMfaMock(id),
    },
    sessions: {
      getSessionList: (args: unknown) => getSessionListMock(args),
      revokeSession: (id: string) => revokeSessionMock(id),
    },
  }),
}));

const sendLinkMock = vi.fn();
vi.mock("@/lib/clients/send-portal-signin-link", () => ({
  sendPortalSignInLink: (args: unknown) => sendLinkMock(args),
}));

vi.mock("@/lib/audit/actor-name", () => ({
  snapshotActorName: async () => "Dana Advisor",
}));
vi.mock("@/lib/branding/branding", () => ({
  resolveFirmName: async () => "Summit Advisory",
}));

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }));

import { POST } from "@/app/api/clients/[id]/portal/account/route";
import { ForbiddenError } from "@/lib/authz";

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: the 403 tests install a THROWING
  // implementation, and clearAllMocks would leave it in place for the rest
  // of the file.
  vi.resetAllMocks();
  h.client = { id: "c1", advisorId: "advisor-2", clerkUserId: "user_xyz" };
  checkLimitMock.mockResolvedValue({ allowed: true });
  getUserMock.mockResolvedValue({
    firstName: "Jane",
    primaryEmailAddressId: "idn_1",
    emailAddresses: [{ id: "idn_1", emailAddress: "jane@example.com" }],
  });
  sendLinkMock.mockResolvedValue({ delivered: true });
  getSessionListMock.mockResolvedValue({ data: [{ id: "sess_1" }, { id: "sess_2" }] });
});

function postReq(body: unknown) {
  return new Request("http://localhost/api/clients/c1/portal/account", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };

describe("POST /api/clients/[id]/portal/account", () => {
  it("rejects an unknown action before touching Clerk", async () => {
    const res = await POST(postReq({ action: "delete_everything" }), ctx);
    expect(res.status).toBe(400);
    expect(getUserMock).not.toHaveBeenCalled();
    expect(disableMfaMock).not.toHaveBeenCalled();
  });

  it("409s every action when the client has no portal login yet", async () => {
    h.client = { id: "c1", advisorId: "advisor-2", clerkUserId: null };
    for (const action of ["send_signin_link", "sign_out_all", "reset_two_factor"]) {
      const res = await POST(postReq({ action }), ctx);
      expect(res.status).toBe(409);
    }
    expect(sendLinkMock).not.toHaveBeenCalled();
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(disableMfaMock).not.toHaveBeenCalled();
  });

  describe("send_signin_link", () => {
    it("sends to the Clerk primary email and reports it back", async () => {
      const res = await POST(postReq({ action: "send_signin_link" }), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, email: "jane@example.com" });
      expect(sendLinkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "c1",
          clerkUserId: "user_xyz",
          email: "jane@example.com",
          clientName: "Jane",
        }),
      );
    });

    it("asks the portal question about the HOUSEHOLD'S advisor, not the sender", async () => {
      await POST(postReq({ action: "send_signin_link" }), ctx);
      expect(portalForAdvisorMock).toHaveBeenCalledWith("firm-1", "advisor-2");
    });

    it("403s without sending when the household's advisor is revoked", async () => {
      portalForAdvisorMock.mockImplementation(() => {
        throw new ForbiddenError("Client portal is not enabled");
      });
      const res = await POST(postReq({ action: "send_signin_link" }), ctx);
      expect(res.status).toBe(403);
      expect(sendLinkMock).not.toHaveBeenCalled();
    });

    it("rejects when rate-limited", async () => {
      checkLimitMock.mockResolvedValue({ allowed: false, reason: "exceeded" });
      const res = await POST(postReq({ action: "send_signin_link" }), ctx);
      expect(res.status).toBe(429);
      expect(sendLinkMock).not.toHaveBeenCalled();
    });

    it("502s rather than reporting success when the email did not go out", async () => {
      sendLinkMock.mockResolvedValue({ delivered: false, reason: "unconfigured" });
      const res = await POST(postReq({ action: "send_signin_link" }), ctx);
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/not configured/i);
    });

    it("409s when the login has no email address to send to", async () => {
      getUserMock.mockResolvedValue({
        firstName: "Jane",
        primaryEmailAddressId: null,
        emailAddresses: [],
      });
      const res = await POST(postReq({ action: "send_signin_link" }), ctx);
      expect(res.status).toBe(409);
      expect(sendLinkMock).not.toHaveBeenCalled();
    });
  });

  describe("sign_out_all", () => {
    it("revokes every active session and audits the count", async () => {
      const res = await POST(postReq({ action: "sign_out_all" }), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, revoked: 2 });
      expect(getSessionListMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_xyz", status: "active" }),
      );
      expect(revokeSessionMock.mock.calls.map((c) => c[0])).toEqual([
        "sess_1",
        "sess_2",
      ]);
      expect(recordAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "portal.sessions.revoked" }),
      );
    });

    it("succeeds with zero when the client is not signed in anywhere", async () => {
      getSessionListMock.mockResolvedValue({ data: [] });
      const res = await POST(postReq({ action: "sign_out_all" }), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, revoked: 0 });
      expect(revokeSessionMock).not.toHaveBeenCalled();
    });

    it("does not need the portal entitlement — revoking access must always work", async () => {
      portalEntitlementMock.mockImplementation(() => {
        throw new ForbiddenError("Client portal is not enabled");
      });
      const res = await POST(postReq({ action: "sign_out_all" }), ctx);
      expect(res.status).toBe(200);
    });
  });

  describe("reset_two_factor", () => {
    it("disables MFA on the client's login and audits it", async () => {
      const res = await POST(postReq({ action: "reset_two_factor" }), ctx);
      expect(res.status).toBe(200);
      expect(disableMfaMock).toHaveBeenCalledWith("user_xyz");
      expect(recordAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "portal.two_factor.reset" }),
      );
    });

    it("500s rather than reporting success when Clerk rejects the reset", async () => {
      disableMfaMock.mockRejectedValue(new Error("clerk down"));
      const res = await POST(postReq({ action: "reset_two_factor" }), ctx);
      expect(res.status).toBe(500);
      expect(recordAuditMock).not.toHaveBeenCalled();
    });
  });
});
