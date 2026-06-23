import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const linkTokenCreate = vi.fn();
vi.mock("@/lib/plaid/client", () => ({
  getPlaidClient: () => ({ linkTokenCreate }),
}));

const resolvePortalClient = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: (...args: unknown[]) => resolvePortalClient(...args),
}));
const requireEditEnabled = vi.fn();
const checkPortalPlaidLinkRateLimit = vi.fn();
const authErrorResponseMock = vi.fn();

vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrorResponseMock(e),
  ForbiddenError: class extends Error {},
}));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (...args: unknown[]) => requireEditEnabled(...args),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkPortalPlaidLinkRateLimit: (...args: unknown[]) =>
    checkPortalPlaidLinkRateLimit(...args),
  rateLimitErrorResponse: (rl: unknown, msg: string) =>
    NextResponse.json({ error: msg }, { status: 429 }),
}));

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

vi.mock("@/lib/plaid/crypto", () => ({
  decrypt: (s: string) => s.replace("enc:", ""),
}));

beforeEach(() => {
  linkTokenCreate.mockReset();
  resolvePortalClient.mockReset();
  requireEditEnabled.mockReset();
  checkPortalPlaidLinkRateLimit.mockReset();
  authErrorResponseMock.mockReset().mockReturnValue(null);
  resolvePortalClient.mockResolvedValue({
    clientId: "client-1",
    mode: "client",
    clerkUserId: "user-1",
  });
  requireEditEnabled.mockResolvedValue(undefined);
  checkPortalPlaidLinkRateLimit.mockResolvedValue({ allowed: true });
  linkTokenCreate.mockResolvedValue({
    data: { link_token: "link-sandbox-abc", expiration: "2026-05-26T00:00:00Z" },
  });
});

describe("POST /api/portal/plaid/link-token", () => {
  it("returns a link token on happy path", async () => {
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.linkToken).toBe("link-sandbox-abc");
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { client_user_id: "client-1" },
        client_name: expect.any(String),
        products: ["auth", "investments", "transactions", "liabilities"],
        country_codes: ["US"],
        language: "en",
      }),
    );
  });

  it("returns 403 when edit disabled", async () => {
    requireEditEnabled.mockRejectedValue(new (class extends Error {})("disabled"));
    authErrorResponseMock.mockReturnValue({ body: { error: "Forbidden" }, status: 403 });
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("returns 429 when rate-limited", async () => {
    checkPortalPlaidLinkRateLimit.mockResolvedValue({
      allowed: false,
      reason: "exceeded",
    });
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(429);
  });

  it("requests update-mode token when itemId provided and item belongs to client", async () => {
    const { db } = await import("@/db");
    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { accessToken: "enc:abc", clientId: "client-1" },
            ]),
        }),
      }),
    });

    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-1" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "abc" }),
    );
  });

  it("returns 404 when itemId belongs to a different client (update mode cross-client)", async () => {
    const { db } = await import("@/db");
    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { accessToken: "enc:xyz", clientId: "other-client" },
            ]),
        }),
      }),
    });

    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-1" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(linkTokenCreate).not.toHaveBeenCalled();
  });

  it("new link requests Transactions + Liabilities", async () => {
    const { POST } = await import("../route");
    await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.products).toEqual(
      expect.arrayContaining(["auth", "investments", "transactions", "liabilities"]),
    );
    expect(arg.additional_consented_products).toBeUndefined();
  });

  it("enableProducts uses update mode with additional_consented_products", async () => {
    const { db } = await import("@/db");
    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { accessToken: "enc:abc", clientId: "client-1" },
            ]),
        }),
      }),
    });

    const { POST } = await import("../route");
    await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-1", enableProducts: true }),
      }),
    );
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.access_token).toBeDefined();
    expect(arg.products).toBeUndefined();
    expect(arg.additional_consented_products).toEqual(
      expect.arrayContaining(["transactions", "liabilities"]),
    );
  });

  it("works in advisor act-as mode (mode=advisor) — still mints a token", async () => {
    resolvePortalClient.mockResolvedValue({
      clientId: "client-1",
      mode: "advisor",
      clerkUserId: "advisor-1",
    });
    const { POST } = await import("../route");
    const res = await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(200);
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user: { client_user_id: "client-1" } }),
    );
  });

  it("plain re-auth (itemId only) omits products AND additional_consented_products", async () => {
    const { db } = await import("@/db");
    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { accessToken: "enc:abc", clientId: "client-1" },
            ]),
        }),
      }),
    });

    const { POST } = await import("../route");
    await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-1" }),
      }),
    );
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.access_token).toBeDefined();
    expect(arg.products).toBeUndefined();
    expect(arg.additional_consented_products).toBeUndefined();
  });

  it("accountSelection adds update.account_selection_enabled in update mode", async () => {
    const { db } = await import("@/db");
    (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { accessToken: "enc:abc", clientId: "client-1" },
            ]),
        }),
      }),
    });

    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-1", accountSelection: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ update: { account_selection_enabled: true } }),
    );
  });
});
