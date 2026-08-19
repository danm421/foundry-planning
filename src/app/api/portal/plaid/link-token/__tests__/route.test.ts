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
  delete process.env.VERCEL_ENV;
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
        products: ["transactions"],
        required_if_supported_products: ["investments", "liabilities"],
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

  // Plaid rejects the Item unless it holds at least one account compatible with
  // EVERY product in `products`. Investments is incompatible with credit/loan;
  // Transactions is incompatible with investment accounts. So each scope may
  // require only its own product — anything else has to be non-blocking, or a
  // client dead-ends after authorising at their bank.
  it("banking scope requires only Transactions — never Investments, never Auth", async () => {
    const { POST } = await import("../route");
    await POST(
      new Request("https://x/", { method: "POST", body: JSON.stringify({ scope: "banking" }) }),
    );
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.products).toEqual(["transactions"]);
    expect(arg.required_if_supported_products).toEqual(["investments", "liabilities"]);
    expect(arg.additional_consented_products).toBeUndefined();
  });

  it("investments scope requires only Investments — never Transactions, never Auth", async () => {
    const { POST } = await import("../route");
    await POST(
      new Request("https://x/", { method: "POST", body: JSON.stringify({ scope: "investments" }) }),
    );
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.products).toEqual(["investments"]);
    expect(arg.required_if_supported_products).toEqual(["transactions", "liabilities"]);
    expect(arg.additional_consented_products).toBeUndefined();
  });

  // A caller that predates `scope` (an older mobile build) gets the broader
  // half — banking covers depository, credit and loan.
  it("omitted scope defaults to banking", async () => {
    const { POST } = await import("../route");
    await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(linkTokenCreate.mock.calls[0][0].products).toEqual(["transactions"]);
  });

  it("rejects an unrecognised scope rather than silently picking one", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", { method: "POST", body: JSON.stringify({ scope: "everything" }) }),
    );
    expect(res.status).toBe(400);
    expect(linkTokenCreate).not.toHaveBeenCalled();
  });

  it("never requests Auth in either scope", async () => {
    // Auth (account/routing numbers) is unused by the app and is not in our
    // Plaid production approval — requesting it fails linkTokenCreate outright
    // with INVALID_PRODUCT in production.
    const { POST } = await import("../route");
    for (const scope of ["banking", "investments"]) {
      await POST(new Request("https://x/", { method: "POST", body: JSON.stringify({ scope }) }));
    }
    for (const call of linkTokenCreate.mock.calls) {
      expect(call[0].products).not.toContain("auth");
      expect(call[0].required_if_supported_products).not.toContain("auth");
      expect(call[0].additional_consented_products ?? []).not.toContain("auth");
    }
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

  it("sends redirect_uri on the production deployment", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.foundryplanning.com";
    const { POST } = await import("../route");
    await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(linkTokenCreate.mock.calls[0][0].redirect_uri).toBe(
      "https://app.foundryplanning.com/portal/oauth",
    );
  });

  it("omits redirect_uri off production (localhost / preview)", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.foundryplanning.com";
    const { POST } = await import("../route");
    await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(linkTokenCreate.mock.calls[0][0].redirect_uri).toBeUndefined();
  });

  it("re-auth (update mode) also carries redirect_uri in production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.foundryplanning.com";
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
    expect(linkTokenCreate.mock.calls[0][0].redirect_uri).toBe(
      "https://app.foundryplanning.com/portal/oauth",
    );
  });

  it("new-link request carries webhook when PLAID_WEBHOOK_URL is set", async () => {
    process.env.PLAID_WEBHOOK_URL = "https://x.example.com/api/webhooks/plaid";
    const { POST } = await import("../route");
    await POST(new Request("https://x/", { method: "POST", body: "{}" }));
    expect(linkTokenCreate.mock.calls[0][0].webhook).toBe(
      "https://x.example.com/api/webhooks/plaid",
    );
    delete process.env.PLAID_WEBHOOK_URL;
  });

  it("update-mode request does NOT carry webhook", async () => {
    process.env.PLAID_WEBHOOK_URL = "https://x.example.com/api/webhooks/plaid";
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
    expect(linkTokenCreate.mock.calls[0][0].webhook).toBeUndefined();
    delete process.env.PLAID_WEBHOOK_URL;
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
