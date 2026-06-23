import { describe, expect, it, vi, beforeEach } from "vitest";

const itemRemove = vi.fn();
vi.mock("@/lib/plaid/client", () => ({
  getPlaidClient: () => ({ itemRemove }),
}));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (s: string) => s.replace("enc:", "") }));

const recordDelete = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordDelete: (...a: unknown[]) => recordDelete(...a),
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
const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
const tx = {
  update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: txUpdateWhere }) }),
  delete: vi.fn().mockReturnValue({ where: txDeleteWhere }),
};
const dbTransaction = vi
  .fn()
  .mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    transaction: dbTransaction,
  },
}));

let currentResp: () => unknown[] = () => [];
beforeEach(() => {
  itemRemove.mockReset();
  recordDelete.mockReset();
  resolvePortalClient.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();
  tx.update.mockClear();
  tx.delete.mockClear();
  txUpdateWhere.mockClear();
  txDeleteWhere.mockClear();
  resolvePortalClient.mockResolvedValue({ clientId: "client-1", mode: "client", clerkUserId: "user-1" });
  requireEditEnabled.mockResolvedValue(undefined);
  dbSelect.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(currentResp()) }) }),
  }));
});

describe("DELETE /api/portal/plaid/items/[id]", () => {
  it("happy path: revokes Plaid token, detaches accounts, deletes plaid_items row, audits", async () => {
    let i = 0;
    const seq = [
      [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:abc", plaidItemId: "plaid-x" }], // item
      [{ firmId: "firm-1" }],                                                                                 // firmId
      [{ id: "acct-1" }, { id: "acct-2" }],                                                                  // linked
    ];
    currentResp = () => seq[i++] ?? [];
    itemRemove.mockResolvedValue({ data: {} });

    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("https://x/", { method: "DELETE" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.detachedCount).toBe(2);
    expect(itemRemove).toHaveBeenCalledWith({ access_token: "abc" });
    expect(tx.update).toHaveBeenCalled(); // clear plaid_item_id on accounts
    expect(tx.delete).toHaveBeenCalled(); // delete plaid_items row
    expect(recordDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.plaid.unlink",
        snapshot: { institutionName: "Chase", detachedCount: 2 },
      }),
    );
  });

  it("rejects foreign item with 404", async () => {
    currentResp = () => [{ clientId: "OTHER" }];
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("https://x/", { method: "DELETE" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(404);
  });
});
