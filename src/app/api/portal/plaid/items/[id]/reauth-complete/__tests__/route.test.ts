import { describe, expect, it, vi, beforeEach } from "vitest";

const recordCreate = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (...a: unknown[]) => recordCreate(...a),
}));
const requireClientPortalAccess = vi.fn();
const requireEditEnabled = vi.fn();
vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: (...a: unknown[]) => requireClientPortalAccess(...a),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (...a: unknown[]) => requireEditEnabled(...a),
}));
const dbSelect = vi.fn();
const dbUpdateWhere = vi.fn().mockResolvedValue(undefined);
const dbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: dbUpdateWhere }),
});
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));

let currentResp: () => unknown[] = () => [];
beforeEach(() => {
  recordCreate.mockReset();
  requireClientPortalAccess.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();
  dbUpdate.mockClear();
  dbUpdateWhere.mockClear();
  requireClientPortalAccess.mockResolvedValue({ clientId: "client-1", clerkUserId: "user-1" });
  requireEditEnabled.mockResolvedValue(undefined);
  dbSelect.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(currentResp()) }) }),
  }));
});

describe("POST /api/portal/plaid/items/[id]/reauth-complete", () => {
  it("clears last_refresh_error and audits", async () => {
    let i = 0;
    const seq = [
      [{ clientId: "client-1", institutionName: "Chase" }], // item
      [{ firmId: "firm-1" }],                                // firmId
    ];
    currentResp = () => seq[i++] ?? [];
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalled();
    expect(recordCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.plaid.reauth" }),
    );
  });

  it("rejects foreign item with 404", async () => {
    currentResp = () => [{ clientId: "OTHER", institutionName: "X" }];
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(404);
  });
});
