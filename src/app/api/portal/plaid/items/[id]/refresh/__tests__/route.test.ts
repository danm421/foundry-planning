import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The write path is extracted into refreshPlaidItemData; the route only wires
// auth → tenant check → rate limit → lib → audit → respond. Mock the lib and
// assert route behavior (passthrough, audit gating, tenant + rate-limit gates).
const refreshPlaidItemData = vi.fn();
vi.mock("@/lib/plaid/refresh-item-data", () => ({
  refreshPlaidItemData: (...a: unknown[]) => refreshPlaidItemData(...a),
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
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
  },
}));

let currentResp: () => unknown[] = () => [];
function nextResponses(...responses: unknown[][]) {
  let i = 0;
  currentResp = () => responses[i++] ?? [];
}

beforeEach(() => {
  refreshPlaidItemData.mockReset();
  recordCreate.mockReset();
  checkRefresh.mockReset();
  resolvePortalClient.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();

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

describe("POST /api/portal/plaid/items/[id]/refresh", () => {
  it("happy path: calls the lib, audits portal.plaid.refresh, passes the result through", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x" }],
      [{ firmId: "firm-1" }],
    );
    refreshPlaidItemData.mockResolvedValue({
      ok: true,
      accountsRefreshed: 2,
      beforeTotal: "300.00",
      afterTotal: "400.00",
    });

    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      accountsRefreshed: 2,
      beforeTotal: "300.00",
      afterTotal: "400.00",
    });
    expect(refreshPlaidItemData).toHaveBeenCalledWith({ id: "item-1", accessToken: "enc:x" });
    expect(recordCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.plaid.refresh",
        resourceId: "item-1",
        firmId: "firm-1",
        snapshot: expect.objectContaining({
          institutionName: "Chase",
          accountsRefreshed: 2,
          beforeTotal: "300.00",
          afterTotal: "400.00",
        }),
      }),
    );
  });

  it("ok:false passes the lib result through with no audit", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x" }],
    );
    refreshPlaidItemData.mockResolvedValue({
      ok: false,
      errorCode: "ITEM_LOGIN_REQUIRED",
      needsReauth: true,
    });
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      errorCode: "ITEM_LOGIN_REQUIRED",
      needsReauth: true,
    });
    expect(recordCreate).not.toHaveBeenCalled();
  });

  it("rate-limited returns 429 without calling the lib", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x" }],
    );
    checkRefresh.mockResolvedValue({ allowed: false, reason: "exceeded" });
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(429);
    expect(refreshPlaidItemData).not.toHaveBeenCalled();
  });

  it("foreign item returns 404 without calling the lib", async () => {
    nextResponses([{ clientId: "OTHER", institutionName: "X", accessToken: "enc:x" }]);
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(404);
    expect(refreshPlaidItemData).not.toHaveBeenCalled();
  });
});
