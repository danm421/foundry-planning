// src/lib/workspace/microsoft/graph.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceConnection } from "../connections";
import type { ProviderTokenSet } from "../types";
import { ProviderRequestError, ProviderThrottledError, WorkspaceReconnectRequiredError } from "../errors";
import { graphFetch, graphJson, graphPages, type GraphContext } from "./graph";
import { MicrosoftAuthError, refreshTokens } from "./oauth";
import { markNeedsReconnect, storeRefreshedTokens } from "../connections";

vi.mock("./oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./oauth")>()),
  refreshTokens: vi.fn(),
}));
vi.mock("../connections", () => ({
  storeRefreshedTokens: vi.fn(),
  markNeedsReconnect: vi.fn(),
}));

const HOUR_MS = 60 * 60 * 1000;

function connection(overrides: Partial<WorkspaceConnection> = {}): WorkspaceConnection {
  return {
    id: "conn-1",
    firmId: "firm-1",
    userId: "user-1",
    provider: "microsoft",
    tenantId: "tenant-1",
    externalUserId: "oid-1",
    externalEmail: "advisor@firm.test",
    accessToken: "AT",
    refreshToken: "RT",
    tokenExpiresAt: new Date(Date.now() + HOUR_MS),
    scope: "Calendars.ReadWrite",
    status: "connected",
    lastError: null,
    connectedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const REFRESHED: ProviderTokenSet = {
  accessToken: "AT2",
  refreshToken: "RT2",
  expiresInSec: 3599,
  scope: "Calendars.ReadWrite",
  idToken: null,
};

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  // 204 and friends may not carry a body.
  const text = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

/** A fetch stub that plays back `responses` in order, one per call. */
function stubFetch(...responses: Response[]) {
  const fetchImpl = vi.fn();
  for (const res of responses) fetchImpl.mockResolvedValueOnce(res);
  const call = (i: number) => {
    const [url, init] = fetchImpl.mock.calls[i] as [string, RequestInit];
    return { url, headers: new Headers(init.headers), init };
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, mock: fetchImpl, call };
}

function context(conn: WorkspaceConnection, fetchImpl: typeof fetch) {
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  const ctx: GraphContext = { conn, fetchImpl, sleep };
  return { ctx, sleep };
}

describe("graphFetch", () => {
  beforeEach(() => {
    vi.mocked(refreshTokens).mockResolvedValue(REFRESHED);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("sends the Bearer token and the mailbox time zone to the Graph v1.0 URL", async () => {
    const { fetchImpl, call } = stubFetch(respond(200, { value: [] }));
    const { ctx } = context(connection(), fetchImpl);

    const res = await graphFetch(ctx, "/me/calendarView?$top=250", { timeZone: "Eastern Standard Time" });

    expect(res.status).toBe(200);
    const sent = call(0);
    expect(sent.url).toBe("https://graph.microsoft.com/v1.0/me/calendarView?$top=250");
    expect(sent.headers.get("authorization")).toBe("Bearer AT");
    expect(sent.headers.get("prefer")).toBe('outlook.timezone="Eastern Standard Time"');
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("passes the context's signal to fetch, so a missed deadline cancels the request", async () => {
    const { fetchImpl, call } = stubFetch(respond(200, { value: [] }));
    const { ctx } = context(connection(), fetchImpl);
    const signal = new AbortController().signal;

    await graphFetch({ ...ctx, signal }, "/me/calendarView");

    expect(call(0).init.signal).toBe(signal);
  });

  it("sends no Prefer header without a time zone, and keeps the caller's method, body and headers", async () => {
    const { fetchImpl, call } = stubFetch(respond(201, { id: "e1" }));
    const { ctx } = context(connection(), fetchImpl);

    await graphFetch(ctx, "/me/events", {
      method: "POST",
      body: '{"subject":"x"}',
      headers: { "content-type": "application/json" },
    });

    const sent = call(0);
    expect(sent.headers.get("prefer")).toBeNull();
    expect(sent.headers.get("content-type")).toBe("application/json");
    expect(sent.init.method).toBe("POST");
    expect(sent.init.body).toBe('{"subject":"x"}');
    expect(sent.init).not.toHaveProperty("timeZone");
  });

  it("a 401 forces one refresh, stores it, and retries with the new token", async () => {
    const { fetchImpl, mock, call } = stubFetch(respond(401), respond(200, { ok: true }));
    const conn = connection();
    const { ctx } = context(conn, fetchImpl);

    const res = await graphFetch(ctx, "/me");

    expect(res.status).toBe(200);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(refreshTokens).toHaveBeenCalledWith({ tenantId: "tenant-1", refreshToken: "RT" });
    expect(storeRefreshedTokens).toHaveBeenCalledWith("conn-1", REFRESHED);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(call(0).headers.get("authorization")).toBe("Bearer AT");
    expect(call(1).headers.get("authorization")).toBe("Bearer AT2");
  });

  it("a second 401 after the refresh is not retried again", async () => {
    const { fetchImpl, mock } = stubFetch(respond(401), respond(401));
    const { ctx } = context(connection(), fetchImpl);

    const err = await graphFetch(ctx, "/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderRequestError);
    expect((err as ProviderRequestError).status).toBe(401);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("(Review Focus 2) throttling: a 429 three times rejects ProviderThrottledError after 3 calls", async () => {
    const throttled = () => respond(429, { error: { code: "TooManyRequests" } }, { "Retry-After": "0", "request-id": "req-429" });
    const { fetchImpl, mock } = stubFetch(throttled(), throttled(), throttled());
    const { ctx, sleep } = context(connection(), fetchImpl);

    const err = await graphFetch(ctx, "/me/calendarView").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderThrottledError);
    expect((err as ProviderThrottledError).requestId).toBe("req-429");
    expect(mock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 0);
  });

  it.each([503, 504])("(Review Focus 2) throttling: a %i is retried like a 429 and can recover", async (status) => {
    const { fetchImpl, mock } = stubFetch(respond(status, "Service Unavailable"), respond(200, { value: [] }));
    const { ctx } = context(connection(), fetchImpl);

    const res = await graphFetch(ctx, "/me/calendarView");

    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing", undefined, 1000],
    ["unparseable", "soon", 1000],
    ["in range", "3", 3000],
    ["over the cap", "120", 5000],
  ])("(Review Focus 2) throttling: a %s Retry-After sleeps the right time", async (_label, retryAfter, expectedMs) => {
    const headers: Record<string, string> = retryAfter === undefined ? {} : { "Retry-After": retryAfter };
    const { fetchImpl } = stubFetch(respond(429, undefined, headers), respond(200, {}));
    const { ctx, sleep } = context(connection(), fetchImpl);

    await graphFetch(ctx, "/me");

    expect(sleep).toHaveBeenCalledWith(expectedMs);
  });

  it("any other error rejects ProviderRequestError with Graph's code, and never logs the body", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl, mock } = stubFetch(
      respond(404, { error: { code: "ErrorItemNotFound", message: "secret" } }, { "request-id": "req-404" }),
    );
    const { ctx } = context(connection(), fetchImpl);

    const err = await graphFetch(ctx, "/me/events/abc").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderRequestError);
    expect(err).toMatchObject({ status: 404, code: "ErrorItemNotFound", requestId: "req-404" });
    expect((err as Error).message).not.toContain("secret");
    expect(mock).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls.flat().map((arg) => String(arg));
    expect(logged.some((s) => s.includes("secret"))).toBe(false);
  });

  it("a non-JSON error body yields code null", async () => {
    const { fetchImpl } = stubFetch(respond(400, "<html>Bad Request</html>"));
    const { ctx } = context(connection(), fetchImpl);

    const err = await graphFetch(ctx, "/me").catch((e: unknown) => e);

    expect(err).toMatchObject({ status: 400, code: null, requestId: null });
  });

  it("an access token expiring within 60 s is refreshed and stored before the first call", async () => {
    const { fetchImpl, mock, call } = stubFetch(respond(200, {}));
    const conn = connection({ tokenExpiresAt: new Date(Date.now() + 30_000) });
    const { ctx } = context(conn, fetchImpl);

    await graphFetch(ctx, "/me");

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(storeRefreshedTokens).toHaveBeenCalledWith("conn-1", REFRESHED);
    expect(vi.mocked(storeRefreshedTokens).mock.invocationCallOrder[0]).toBeLessThan(
      mock.mock.invocationCallOrder[0],
    );
    expect(call(0).headers.get("authorization")).toBe("Bearer AT2");
  });

  it("a refreshed connection is reused by the next call without refreshing again", async () => {
    const { fetchImpl } = stubFetch(respond(200, {}), respond(200, {}));
    const conn = connection({ tokenExpiresAt: new Date(Date.now() + 30_000) });
    const { ctx } = context(conn, fetchImpl);

    await graphFetch(ctx, "/me");
    await graphFetch(ctx, "/me");

    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("(Review Focus 1) revoked sign-in: invalid_grant marks the connection needs-reconnect and rejects WorkspaceReconnectRequiredError", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new MicrosoftAuthError("invalid_grant", 400));
    const { fetchImpl, mock } = stubFetch();
    const conn = connection({ tokenExpiresAt: new Date(Date.now() + 30_000) });
    const { ctx } = context(conn, fetchImpl);

    const err = await graphFetch(ctx, "/me/calendarView").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceReconnectRequiredError);
    expect(markNeedsReconnect).toHaveBeenCalledWith("conn-1", "invalid_grant");
    expect(storeRefreshedTokens).not.toHaveBeenCalled();
    expect(mock).not.toHaveBeenCalled();
  });

  it("(Review Focus 1) revoked sign-in: interaction_required on a 401's forced refresh also needs reconnect", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new MicrosoftAuthError("interaction_required", 400));
    const { fetchImpl, mock } = stubFetch(respond(401));
    const { ctx } = context(connection(), fetchImpl);

    const err = await graphFetch(ctx, "/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceReconnectRequiredError);
    expect(markNeedsReconnect).toHaveBeenCalledWith("conn-1", "interaction_required");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("any other refresh failure propagates unchanged and does not mark the connection", async () => {
    const outage = new MicrosoftAuthError("temporarily_unavailable", 503);
    vi.mocked(refreshTokens).mockRejectedValue(outage);
    const { fetchImpl } = stubFetch();
    const conn = connection({ tokenExpiresAt: new Date(Date.now() + 30_000) });
    const { ctx } = context(conn, fetchImpl);

    await expect(graphFetch(ctx, "/me")).rejects.toBe(outage);
    expect(markNeedsReconnect).not.toHaveBeenCalled();
  });
});

describe("graphJson", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("parses a JSON body", async () => {
    const { fetchImpl } = stubFetch(respond(200, { value: "Eastern Standard Time" }));
    const { ctx } = context(connection(), fetchImpl);

    await expect(graphJson<{ value: string }>(ctx, "/me/mailboxSettings/timeZone")).resolves.toEqual({
      value: "Eastern Standard Time",
    });
  });

  it.each([202, 204])("returns undefined on a %i", async (status) => {
    const { fetchImpl } = stubFetch(respond(status));
    const { ctx } = context(connection(), fetchImpl);

    await expect(graphJson(ctx, "/me/events/abc", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("graphPages", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("follows an absolute nextLink as a path and joins the pages", async () => {
    const { fetchImpl, call } = stubFetch(
      respond(200, { value: [1], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/x?$skip=1" }),
      respond(200, { value: [2] }),
    );
    const { ctx } = context(connection(), fetchImpl);

    await expect(graphPages<number>(ctx, "/me/x")).resolves.toEqual([1, 2]);
    expect(call(1).url).toBe("https://graph.microsoft.com/v1.0/me/x?$skip=1");
  });

  it("refuses a nextLink outside Graph v1.0 without fetching it", async () => {
    const { fetchImpl, mock } = stubFetch(
      respond(200, { value: [1], "@odata.nextLink": "https://evil.test/v1.0/me/x" }),
    );
    const { ctx } = context(connection(), fetchImpl);

    await expect(graphPages<number>(ctx, "/me/x")).rejects.toThrow(/nextLink/);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
