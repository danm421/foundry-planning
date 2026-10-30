// src/lib/workspace/google/api.test.ts
import { inspect } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceConnection } from "../connections";
import type { ProviderTokenSet } from "../types";
import { ProviderRequestError, ProviderThrottledError, WorkspaceReconnectRequiredError } from "../errors";
import { googleFetch, googleJson, googlePages, type GoogleContext } from "./api";
import { GoogleAuthError, refreshTokens } from "./oauth";
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
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const LISTS_URL = "https://tasks.googleapis.com/tasks/v1/users/@me/lists";

function connection(overrides: Partial<WorkspaceConnection> = {}): WorkspaceConnection {
  return {
    id: "conn-1",
    firmId: "firm-1",
    userId: "user-1",
    provider: "google",
    tenantId: "",
    externalUserId: "sub-1",
    externalEmail: "advisor@gmail.test",
    accessToken: "AT",
    refreshToken: "RT",
    tokenExpiresAt: new Date(Date.now() + HOUR_MS),
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
    status: "connected",
    lastError: null,
    connectedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const REFRESHED: ProviderTokenSet = {
  accessToken: "AT2",
  refreshToken: "RT",
  expiresInSec: 3599,
  scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
  idToken: null,
};

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  // 204 and friends may not carry a body.
  const text = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

/** Google's error envelope, as Calendar v3 and Tasks v1 send it. */
function googleError(status: number, reason: string, message = "An error") {
  return { error: { code: status, message, errors: [{ domain: "global", reason, message }] } };
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
  const ctx: GoogleContext = { conn, fetchImpl, sleep };
  return { ctx, sleep };
}

describe("googleFetch", () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    vi.mocked(refreshTokens).mockResolvedValue(REFRESHED);
    consoleSpies = (["error", "warn", "log", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  /** Every argument any console method received, rendered deeply (an Error with its message and stack). */
  function everythingLogged(): string {
    return consoleSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => inspect(arg, { depth: null }))
      .join("\n");
  }

  it.each([
    ["another host", "https://evil.test/calendar/v3/calendars/primary/events"],
    ["a look-alike host", "https://www.googleapis.com.evil.test/calendar/v3/calendars/primary/events"],
    ["the Google host behind another", "https://evil.test/https://www.googleapis.com/calendar/v3/"],
    ["plain http", "http://www.googleapis.com/calendar/v3/calendars/primary/events"],
    ["another Google API", "https://www.googleapis.com/gmail/v1/users/me/messages"],
    ["another Tasks version", "https://tasks.googleapis.com/tasks/v2/users/@me/lists"],
    ["a dot-segment path escaping the Calendar base", "https://www.googleapis.com/calendar/v3/../../gmail/v1/users/me/messages"],
    ["an encoded dot-segment path", "https://www.googleapis.com/calendar/v3/%2e%2e/%2e%2e/gmail/v1/users/me/messages"],
    ["a relative path", "/calendar/v3/calendars/primary/events"],
  ])("refuses %s before refreshing or sending anything", async (_label, url) => {
    const { fetchImpl, mock } = stubFetch(respond(200, {}));
    const { ctx } = context(connection({ tokenExpiresAt: new Date(Date.now() + 30_000) }), fetchImpl);

    await expect(googleFetch(ctx, url)).rejects.toThrow(/outside/);
    expect(mock).not.toHaveBeenCalled();
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it.each([EVENTS_URL, LISTS_URL])("sends the Bearer token to %s and keeps the caller's method, body and headers", async (url) => {
    const { fetchImpl, call } = stubFetch(respond(200, { id: "x" }));
    const { ctx } = context(connection(), fetchImpl);

    const res = await googleFetch(ctx, url, {
      method: "POST",
      body: '{"summary":"x"}',
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    const sent = call(0);
    expect(sent.url).toBe(url);
    expect(sent.headers.get("authorization")).toBe("Bearer AT");
    expect(sent.headers.get("content-type")).toBe("application/json");
    expect(sent.init.method).toBe("POST");
    expect(sent.init.body).toBe('{"summary":"x"}');
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("a 401 forces one refresh, stores it, and retries with the new token", async () => {
    const { fetchImpl, mock, call } = stubFetch(respond(401), respond(200, { items: [] }));
    const { ctx } = context(connection(), fetchImpl);

    const res = await googleFetch(ctx, EVENTS_URL);

    expect(res.status).toBe(200);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(refreshTokens).toHaveBeenCalledWith({ refreshToken: "RT" });
    expect(storeRefreshedTokens).toHaveBeenCalledWith("conn-1", REFRESHED);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(call(0).headers.get("authorization")).toBe("Bearer AT");
    expect(call(1).headers.get("authorization")).toBe("Bearer AT2");
  });

  it("a second 401 after the refresh is not retried again", async () => {
    const { fetchImpl, mock } = stubFetch(respond(401), respond(401, googleError(401, "authError")));
    const { ctx } = context(connection(), fetchImpl);

    const err = await googleFetch(ctx, EVENTS_URL).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderRequestError);
    expect(err).toMatchObject({ provider: "google", status: 401, code: "authError" });
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("(Review Focus 1) a 403 rateLimitExceeded three times rejects ProviderThrottledError after 3 calls", async () => {
    const limited = () => respond(403, googleError(403, "rateLimitExceeded"), { "Retry-After": "0" });
    const { fetchImpl, mock } = stubFetch(limited(), limited(), limited());
    const { ctx, sleep } = context(connection(), fetchImpl);

    const err = await googleFetch(ctx, EVENTS_URL).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderThrottledError);
    expect(err).toMatchObject({ provider: "google", requestId: null });
    expect(mock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 0);
  });

  it("a 403 userRateLimitExceeded is busy too, and can recover", async () => {
    const { fetchImpl, mock } = stubFetch(respond(403, googleError(403, "userRateLimitExceeded")), respond(200, {}));
    const { ctx } = context(connection(), fetchImpl);

    const res = await googleFetch(ctx, LISTS_URL);

    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("any other 403 is a ProviderRequestError with Google's reason, not retried", async () => {
    const { fetchImpl, mock } = stubFetch(respond(403, googleError(403, "forbiddenForNonOrganizer")));
    const { ctx, sleep } = context(connection(), fetchImpl);

    const err = await googleFetch(ctx, EVENTS_URL).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderRequestError);
    expect(err).toMatchObject({ provider: "google", status: 403, code: "forbiddenForNonOrganizer", requestId: null });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([429, 500, 502, 503, 504])("(Review Focus 1) a %i is retried as busy and can recover", async (status) => {
    const { fetchImpl, mock } = stubFetch(respond(status, "<html>Backend Error</html>"), respond(200, {}));
    const { ctx } = context(connection(), fetchImpl);

    const res = await googleFetch(ctx, EVENTS_URL);

    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["POST", 500],
    ["POST", 502],
    ["post", 500],
  ])("(M5) a %s answering %i is sent once, never retried (it may have landed)", async (method, status) => {
    const { fetchImpl, mock } = stubFetch(respond(status, googleError(status, "backendError")), respond(200, {}));
    const { ctx, sleep } = context(connection(), fetchImpl);

    const err = await googleFetch(ctx, EVENTS_URL, { method, body: "{}" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderRequestError);
    expect(err).toMatchObject({ provider: "google", status, code: "backendError" });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([429, 503])("(M5) a POST answering %i is still retried as busy (Google refused it)", async (status) => {
    const { fetchImpl, mock } = stubFetch(respond(status), respond(200, {}));
    const { ctx } = context(connection(), fetchImpl);

    expect((await googleFetch(ctx, EVENTS_URL, { method: "POST", body: "{}" })).status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each(["GET", "PATCH", "DELETE"])("(M5) a %s answering 502 is still retried", async (method) => {
    const { fetchImpl, mock } = stubFetch(respond(502), respond(200, {}));
    const { ctx } = context(connection(), fetchImpl);

    expect((await googleFetch(ctx, EVENTS_URL, { method })).status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing", undefined, 1000],
    ["unparseable", "soon", 1000],
    ["in range", "3", 3000],
    ["over the cap", "120", 5000],
  ])("a %s Retry-After sleeps the right time", async (_label, retryAfter, expectedMs) => {
    const headers: Record<string, string> = retryAfter === undefined ? {} : { "Retry-After": retryAfter };
    const { fetchImpl } = stubFetch(respond(429, undefined, headers), respond(200, {}));
    const { ctx, sleep } = context(connection(), fetchImpl);

    await googleFetch(ctx, EVENTS_URL);

    expect(sleep).toHaveBeenCalledWith(expectedMs);
  });

  it("a 404 rejects ProviderRequestError with Google's reason; the body never reaches the error or a log", async () => {
    const { fetchImpl, mock } = stubFetch(respond(404, googleError(404, "notFound", "secret")));
    const { ctx } = context(connection(), fetchImpl);

    const err = await googleFetch(ctx, `${EVENTS_URL}/abc`).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderRequestError);
    expect(err).toMatchObject({ provider: "google", status: 404, code: "notFound", requestId: null });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(inspect(err, { depth: null })).not.toContain("secret");
    expect(everythingLogged()).not.toContain("secret");
  });

  it("a non-JSON error body yields code null", async () => {
    const { fetchImpl } = stubFetch(respond(400, "<html>Bad Request</html>"));
    const { ctx } = context(connection(), fetchImpl);

    const err = await googleFetch(ctx, EVENTS_URL).catch((e: unknown) => e);

    expect(err).toMatchObject({ status: 400, code: null, requestId: null });
  });

  it("an access token expiring within 60 s is refreshed and stored before the first call", async () => {
    const { fetchImpl, mock, call } = stubFetch(respond(200, {}));
    const { ctx } = context(connection({ tokenExpiresAt: new Date(Date.now() + 30_000) }), fetchImpl);

    await googleFetch(ctx, EVENTS_URL);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(storeRefreshedTokens).toHaveBeenCalledWith("conn-1", REFRESHED);
    expect(vi.mocked(storeRefreshedTokens).mock.invocationCallOrder[0]).toBeLessThan(
      mock.mock.invocationCallOrder[0],
    );
    expect(call(0).headers.get("authorization")).toBe("Bearer AT2");
  });

  it("a refreshed connection is reused by the next call without refreshing again", async () => {
    const { fetchImpl } = stubFetch(respond(200, {}), respond(200, {}));
    const { ctx } = context(connection({ tokenExpiresAt: new Date(Date.now() + 30_000) }), fetchImpl);

    await googleFetch(ctx, EVENTS_URL);
    await googleFetch(ctx, EVENTS_URL);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("(Review Focus 1) revoked sign-in: invalid_grant marks the connection needs-reconnect and rejects WorkspaceReconnectRequiredError", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new GoogleAuthError("invalid_grant", 400));
    const { fetchImpl, mock } = stubFetch();
    const { ctx } = context(connection({ tokenExpiresAt: new Date(Date.now() + 30_000) }), fetchImpl);

    const err = await googleFetch(ctx, EVENTS_URL).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceReconnectRequiredError);
    expect(markNeedsReconnect).toHaveBeenCalledWith("conn-1", "invalid_grant");
    expect(storeRefreshedTokens).not.toHaveBeenCalled();
    expect(mock).not.toHaveBeenCalled();
  });

  it("(Review Focus 1) revoked mid-read: invalid_grant on a 401's forced refresh also needs reconnect", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new GoogleAuthError("invalid_grant", 400));
    const { fetchImpl, mock } = stubFetch(respond(401));
    const { ctx } = context(connection(), fetchImpl);

    const err = await googleFetch(ctx, EVENTS_URL).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceReconnectRequiredError);
    expect(markNeedsReconnect).toHaveBeenCalledWith("conn-1", "invalid_grant");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("any other refresh failure propagates unchanged and does not mark the connection", async () => {
    const outage = new GoogleAuthError("temporarily_unavailable", 503);
    vi.mocked(refreshTokens).mockRejectedValue(outage);
    const { fetchImpl } = stubFetch();
    const { ctx } = context(connection({ tokenExpiresAt: new Date(Date.now() + 30_000) }), fetchImpl);

    await expect(googleFetch(ctx, EVENTS_URL)).rejects.toBe(outage);
    expect(markNeedsReconnect).not.toHaveBeenCalled();
  });
});

describe("googleJson", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("parses a JSON body", async () => {
    const { fetchImpl } = stubFetch(respond(200, { timeZone: "America/Chicago" }));
    const { ctx } = context(connection(), fetchImpl);

    await expect(googleJson<{ timeZone: string }>(ctx, `${EVENTS_URL}?maxResults=1`)).resolves.toEqual({
      timeZone: "America/Chicago",
    });
  });

  it("returns undefined on a 204", async () => {
    const { fetchImpl } = stubFetch(respond(204));
    const { ctx } = context(connection(), fetchImpl);

    await expect(googleJson(ctx, `${EVENTS_URL}/abc`, { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("googlePages", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("follows nextPageToken twice, keeping the query and joining the pages", async () => {
    const { fetchImpl, mock, call } = stubFetch(
      respond(200, { items: [1], nextPageToken: "p2" }),
      respond(200, { items: [2], nextPageToken: "p3" }),
      respond(200, { items: [3] }),
    );
    const { ctx } = context(connection(), fetchImpl);

    await expect(googlePages<number>(ctx, `${LISTS_URL}?maxResults=100`)).resolves.toEqual([1, 2, 3]);

    expect(mock).toHaveBeenCalledTimes(3);
    expect(call(0).url).toBe(`${LISTS_URL}?maxResults=100`);
    const second = new URL(call(1).url);
    expect(`${second.origin}${second.pathname}`).toBe(LISTS_URL);
    expect(second.searchParams.get("maxResults")).toBe("100");
    expect(second.searchParams.get("pageToken")).toBe("p2");
    expect(new URL(call(2).url).searchParams.get("pageToken")).toBe("p3");
  });

  it("a page without items counts as empty", async () => {
    const { fetchImpl } = stubFetch(respond(200, {}));
    const { ctx } = context(connection(), fetchImpl);

    await expect(googlePages<number>(ctx, LISTS_URL)).resolves.toEqual([]);
  });
});
