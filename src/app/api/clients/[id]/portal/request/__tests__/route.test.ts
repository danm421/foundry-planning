import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Auth mocks (mirrors the sibling invite/disable route tests) ---
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-1" }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const requireClientEditAccessMock = vi.fn();
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: (id: string) => requireClientEditAccessMock(id),
}));

const subscriptionMock = vi.fn();
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireActiveSubscriptionForFirm: async (firmId: string) => subscriptionMock(firmId),
  };
});

vi.mock("@/lib/clients/cross-firm-audit", () => ({
  crossFirmAuditMeta: (_a: unknown, _b: unknown, base?: Record<string, unknown>) => base ?? {},
}));

const deletePendingBindingMock = vi.fn();
vi.mock("@/lib/portal/bindings", () => ({
  deletePendingBinding: (bindingId: string, clientId: string) =>
    deletePendingBindingMock(bindingId, clientId),
}));

const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }));

import { DELETE } from "@/app/api/clients/[id]/portal/request/route";
import { ForbiddenError } from "@/lib/authz";

function del(body?: unknown) {
  return new Request("http://localhost/api/clients/c1/portal/request", {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  requireClientEditAccessMock.mockResolvedValue({
    firmId: "firm-1",
    access: "own",
    client: { id: "c1", advisorId: "advisor-1" },
  });
  deletePendingBindingMock.mockResolvedValue(true);
});

describe("DELETE /api/clients/[id]/portal/request", () => {
  it("cancels the pending request, scoped to the household", async () => {
    const res = await DELETE(del({ bindingId: "b1" }), ctx);
    expect(res.status).toBe(200);
    // The clientId is the second argument on purpose: without it a stray
    // binding id would reach another household's pending row.
    expect(deletePendingBindingMock).toHaveBeenCalledWith("b1", "c1");
  });

  it("checks this advisor may edit THIS client before deleting anything", async () => {
    requireClientEditAccessMock.mockRejectedValue(new ForbiddenError("nope"));
    const res = await DELETE(del({ bindingId: "b1" }), ctx);
    expect(res.status).toBe(403);
    expect(deletePendingBindingMock).not.toHaveBeenCalled();
  });

  it("400s without a bindingId rather than guessing which request to cancel", async () => {
    const res = await DELETE(del({}), ctx);
    expect(res.status).toBe(400);
    expect(deletePendingBindingMock).not.toHaveBeenCalled();
  });

  it("404s when the request is already gone — accepted, declined or expired", async () => {
    deletePendingBindingMock.mockResolvedValue(false);
    const res = await DELETE(del({ bindingId: "b1" }), ctx);
    expect(res.status).toBe(404);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("audits the withdrawal against the binding it removed", async () => {
    await DELETE(del({ bindingId: "b1" }), ctx);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.invite.revoked",
        resourceId: "b1",
        clientId: "c1",
        firmId: "firm-1",
      }),
    );
  });
});
