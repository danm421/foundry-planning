import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const fetchBalancesForItem = vi.fn();
vi.mock("@/lib/plaid/refresh", () => ({
  fetchBalancesForItem: (...a: unknown[]) => fetchBalancesForItem(...a),
}));

const recordCreate = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (...a: unknown[]) => recordCreate(...a),
}));

const checkRefresh = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkPortalPlaidRefreshRateLimit: (...a: unknown[]) => checkRefresh(...a),
  rateLimitErrorResponse: (rl: unknown, msg: string) =>
    NextResponse.json({ error: msg }, { status: 429 }),
}));

const requireClientPortalAccess = vi.fn();
const requireEditEnabled = vi.fn();
vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: (...a: unknown[]) => requireClientPortalAccess(...a),
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
const tx = {
  update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: txUpdateWhere }) }),
};
const dbTransaction = vi
  .fn()
  .mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
const dbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
});
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    transaction: dbTransaction,
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));

let currentResp: () => unknown[] = () => [];
function nextResponses(...responses: unknown[][]) {
  let i = 0;
  currentResp = () => responses[i++] ?? [];
}

beforeEach(() => {
  fetchBalancesForItem.mockReset();
  recordCreate.mockReset();
  checkRefresh.mockReset();
  requireClientPortalAccess.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();
  dbUpdate.mockClear();
  tx.update.mockClear();
  txUpdateWhere.mockClear();

  requireClientPortalAccess.mockResolvedValue({ clientId: "client-1", clerkUserId: "user-1" });
  requireEditEnabled.mockResolvedValue(undefined);
  checkRefresh.mockResolvedValue({ allowed: true });
  dbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(currentResp()),
      }),
    }),
  }));
});

describe("POST /api/portal/plaid/items/[id]/refresh", () => {
  it("happy path: updates balances + clears last_refresh_error + audits", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x", plaidItemId: "plaid-x" }],
      [
        { id: "acct-1", plaidAccountId: "pa-1", value: "100.00" },
        { id: "acct-2", plaidAccountId: "pa-2", value: "200.00" },
      ],
      [{ firmId: "firm-1" }],
    );
    fetchBalancesForItem.mockResolvedValue({
      ok: true,
      updates: [
        { plaidAccountId: "pa-1", newValue: "150.00" },
        { plaidAccountId: "pa-2", newValue: "250.00" },
      ],
    });

    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.accountsRefreshed).toBe(2);
    expect(json.beforeTotal).toBe("300.00");
    expect(json.afterTotal).toBe("400.00");
    expect(recordCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.plaid.refresh" }),
    );
  });

  it("ITEM_LOGIN_REQUIRED: writes last_refresh_error, returns ok:false, no audit", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x", plaidItemId: "plaid-x" }],
      [{ id: "acct-1", plaidAccountId: "pa-1", value: "100.00" }],
    );
    fetchBalancesForItem.mockResolvedValue({
      ok: false,
      errorCode: "ITEM_LOGIN_REQUIRED",
      errorMessage: "re-auth",
    });
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(recordCreate).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalled();
  });

  it("rate-limited returns 429", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x", plaidItemId: "plaid-x" }],
    );
    checkRefresh.mockResolvedValue({ allowed: false, reason: "exceeded" });
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(429);
  });

  it("foreign item returns 404", async () => {
    nextResponses([{ clientId: "OTHER", institutionName: "X", accessToken: "enc:x", plaidItemId: "p" }]);
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(404);
  });
});
