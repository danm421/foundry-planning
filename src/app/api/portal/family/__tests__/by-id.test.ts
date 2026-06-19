import { describe, it, expect, vi, beforeEach } from "vitest";

const requirePortalMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: () => requirePortalMock(),
  ForbiddenError: class ForbiddenError extends Error {},
  authErrorResponse: () => null,
}));

const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

const selectChain = vi.fn();
const updateChain = vi.fn();
const deleteChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => selectChain() }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => updateChain() }),
    }),
    delete: () => ({ where: () => deleteChain() }),
  },
}));

const recordUpdateMock = vi.fn();
const recordDeleteMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (...args: unknown[]) => recordUpdateMock(...args),
  recordDelete: (...args: unknown[]) => recordDeleteMock(...args),
}));

import { PUT, DELETE } from "@/app/api/portal/family/[id]/route";

beforeEach(() => {
  requirePortalMock.mockReset();
  requireEditEnabledMock.mockReset();
  selectChain.mockReset();
  updateChain.mockReset();
  deleteChain.mockReset();
  recordUpdateMock.mockReset();
  recordDeleteMock.mockReset();
});

function putReq(body: unknown) {
  return new Request("http://localhost/api/portal/family/fm1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("PUT /api/portal/family/[id]", () => {
  it("404s when the family member doesn't belong to the bound client", async () => {
    requirePortalMock.mockResolvedValue({ clientId: "c1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain.mockResolvedValue([{ clientId: "other-client", id: "fm1" }]);
    const res = await PUT(putReq({ firstName: "X" }), {
      params: Promise.resolve({ id: "fm1" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid relationship value with 400", async () => {
    requirePortalMock.mockResolvedValue({ clientId: "c1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain.mockResolvedValueOnce([{ clientId: "c1", firmId: "firm-1", id: "fm1", firstName: "Old" }]);
    const res = await PUT(putReq({ relationship: "bogus" }), {
      params: Promise.resolve({ id: "fm1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid relationship");
  });

  it("updates fields when target row is owned by the bound client", async () => {
    requirePortalMock.mockResolvedValue({ clientId: "c1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain.mockResolvedValueOnce([{ clientId: "c1", firmId: "firm-1", id: "fm1", firstName: "Old" }]);
    const res = await PUT(putReq({ firstName: "New" }), {
      params: Promise.resolve({ id: "fm1" }),
    });
    expect(res.status).toBe(200);
    expect(updateChain).toHaveBeenCalled();
    expect(recordUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ actorKind: "client", firmId: "firm-1" }));
  });
});

describe("DELETE /api/portal/family/[id]", () => {
  it("deletes when target row is owned by the bound client", async () => {
    requirePortalMock.mockResolvedValue({ clientId: "c1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain.mockResolvedValue([{ clientId: "c1", firmId: "firm-1", id: "fm1" }]);
    const res = await DELETE(
      new Request("http://localhost/api/portal/family/fm1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "fm1" }) },
    );
    expect(res.status).toBe(200);
    expect(deleteChain).toHaveBeenCalled();
    expect(recordDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ actorKind: "client", firmId: "firm-1" }));
  });
});
