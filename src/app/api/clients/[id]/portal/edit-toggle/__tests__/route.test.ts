import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Auth mocks (real idiom, mirrors disable route) ---
const requireClientEditAccessMock = vi.fn();
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: (id: string) => requireClientEditAccessMock(id),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  authErrorResponse: () => undefined,
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

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { PUT } from "@/app/api/clients/[id]/portal/edit-toggle/route";

beforeEach(() => {
  requireClientEditAccessMock.mockReset();
  updateChain.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/clients/c1/portal/edit-toggle", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("PUT /api/clients/[id]/portal/edit-toggle", () => {
  it("rejects non-boolean enabled", async () => {
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "c1" },
    });
    const res = await PUT(req({ enabled: "yes" }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(400);
    expect(updateChain).not.toHaveBeenCalled();
  });

  it("updates portal_edit_enabled to the supplied value", async () => {
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "c1" },
    });
    const res = await PUT(req({ enabled: false }), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ portalEditEnabled: false }),
    );
  });
});
