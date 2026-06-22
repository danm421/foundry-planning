import { describe, it, expect, vi, beforeEach } from "vitest";

const requirePortalMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: () => requirePortalMock(),
  ForbiddenError: class ForbiddenError extends Error {},
  authErrorResponse: () => null,
}));

const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

const selectChain = vi.fn();
const updateChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => selectChain() }) }) }),
    update: () => ({ set: () => ({ where: () => updateChain() }) }),
  },
}));

const recordUpdateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (...args: unknown[]) => recordUpdateMock(...args),
}));

import { PUT } from "@/app/api/portal/trusts/[id]/route";

beforeEach(() => {
  requirePortalMock.mockReset();
  requireEditEnabledMock.mockReset();
  selectChain.mockReset();
  updateChain.mockReset();
  recordUpdateMock.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/portal/trusts/t1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("PUT /api/portal/trusts/[id]", () => {
  it("404s when trust is not owned by the bound client", async () => {
    requirePortalMock.mockResolvedValue({ clientId: "c1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain.mockResolvedValue([{ clientId: "other", id: "t1" }]);
    const res = await PUT(req({ name: "Renamed" }), {
      params: Promise.resolve({ id: "t1" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates the allowed fields", async () => {
    requirePortalMock.mockResolvedValue({ clientId: "c1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain.mockResolvedValueOnce([{ clientId: "c1", firmId: "firm-1", id: "t1", name: "Old", entityType: "trust" }]);
    const res = await PUT(req({ name: "New" }), {
      params: Promise.resolve({ id: "t1" }),
    });
    expect(res.status).toBe(200);
    expect(updateChain).toHaveBeenCalled();
    expect(recordUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ actorKind: "client", firmId: "firm-1" }));
  });
});
