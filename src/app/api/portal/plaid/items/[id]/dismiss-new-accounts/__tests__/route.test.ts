import { describe, expect, it, vi, beforeEach } from "vitest";

const recordCreate = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (...a: unknown[]) => recordCreate(...a),
}));
const resolvePortalClient = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: (...a: unknown[]) => resolvePortalClient(...a),
}));
const requireEditEnabled = vi.fn();
vi.mock("@/lib/authz", () => ({
  authErrorResponse: () => null,
}));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
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
  resolvePortalClient.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();
  dbUpdate.mockClear();
  dbUpdateWhere.mockClear();
  resolvePortalClient.mockResolvedValue({ clientId: "client-1", mode: "client", clerkUserId: "user-1" });
  requireEditEnabled.mockResolvedValue(undefined);
  dbSelect.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(currentResp()) }) }),
  }));
});

describe("POST /api/portal/plaid/items/[id]/dismiss-new-accounts", () => {
  it("clears new_accounts_available_at and audits", async () => {
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
    const setMock = dbUpdate.mock.results[0].value.set as ReturnType<typeof vi.fn>;
    expect(setMock).toHaveBeenCalledWith({ newAccountsAvailableAt: null });
    expect(recordCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.plaid.dismiss_new_accounts" }),
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
