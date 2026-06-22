import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClerkAPIResponseError } from "@clerk/nextjs/errors";

// --- Auth mocks (real idiom, not @/lib/authz-clients) ---
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
}));

vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: async () => ({
    firmId: "firm-1",
    access: "own",
    client: { id: "c1" },
  }),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  authErrorResponse: () => undefined,
}));

vi.mock("@/lib/clients/cross-firm-audit", () => ({
  crossFirmAuditMeta: (..._a: unknown[]) => ({}),
}));

// --- Rate-limit mock ---
const checkLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkPortalInviteRateLimit: (k: string) => checkLimitMock(k),
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

beforeEach(() => {
  checkLimitMock.mockReset();
  createInvitationMock.mockReset();
  revokeInvitationMock.mockReset();
  getInvitationListMock.mockReset();
  updateMock.mockReset();
});

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
    expect((await res.json()).error).toMatch(/already has an account/i);
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

  it("still returns 500 for a non-Clerk failure", async () => {
    checkLimitMock.mockResolvedValue({ allowed: true });
    createInvitationMock.mockRejectedValue(new Error("network down"));
    const res = await POST(postReq({ email: "client@example.com" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(500);
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
