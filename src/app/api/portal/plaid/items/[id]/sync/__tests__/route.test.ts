import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const syncTransactionsForItem = vi.fn();
vi.mock("@/lib/plaid/transactions-sync", () => ({
  syncTransactionsForItem: (...a: unknown[]) => syncTransactionsForItem(...a),
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
const dbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
});
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));

let currentResp: () => unknown[] = () => [];
function nextResponses(...responses: unknown[][]) {
  let i = 0;
  currentResp = () => responses[i++] ?? [];
}

beforeEach(() => {
  syncTransactionsForItem.mockReset();
  recordCreate.mockReset();
  checkRefresh.mockReset();
  resolvePortalClient.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();
  dbUpdate.mockClear();

  resolvePortalClient.mockResolvedValue({ clientId: "client-1", mode: "client", clerkUserId: "user-1" });
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

describe("POST /api/portal/plaid/items/[id]/sync", () => {
  it("syncs and returns counts", async () => {
    nextResponses(
      [{ id: "item-1", clientId: "client-1", accessToken: "enc:x", transactionsCursor: null }],
      [{ firmId: "firm-1" }],
    );
    syncTransactionsForItem.mockResolvedValue({ ok: true, added: 3, modified: 1, removed: 0 });

    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, added: 3, modified: 1, removed: 0 });
    expect(recordCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.plaid.sync" }),
    );
  });

  it("404s when the item belongs to another client", async () => {
    nextResponses([{ id: "item-1", clientId: "OTHER", accessToken: "enc:x", transactionsCursor: null }]);

    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("409 on ITEM_LOGIN_REQUIRED + persists lastRefreshError", async () => {
    nextResponses([{ id: "item-1", clientId: "client-1", accessToken: "enc:x", transactionsCursor: null }]);
    syncTransactionsForItem.mockResolvedValue({
      ok: false,
      errorCode: "ITEM_LOGIN_REQUIRED",
      errorMessage: "re-auth required",
    });

    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(recordCreate).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalled();
  });

  it("502 on other Plaid error + persists lastRefreshError", async () => {
    nextResponses([{ id: "item-1", clientId: "client-1", accessToken: "enc:x", transactionsCursor: null }]);
    syncTransactionsForItem.mockResolvedValue({
      ok: false,
      errorCode: "INTERNAL_SERVER_ERROR",
      errorMessage: "plaid error",
    });

    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(502);
    expect(recordCreate).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalled();
  });

  it("rate-limited returns 429", async () => {
    nextResponses([{ id: "item-1", clientId: "client-1", accessToken: "enc:x", transactionsCursor: null }]);
    checkRefresh.mockResolvedValue({ allowed: false, reason: "exceeded" });

    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(429);
  });
});
