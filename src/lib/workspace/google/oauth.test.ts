// src/lib/workspace/google/oauth.test.ts
import { inspect } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCode,
  GoogleAuthError,
  hasRequiredScopes,
  readIdTokenClaims,
  refreshTokens,
  revokeToken,
} from "./oauth";

const CLIENT_ID = "cid.apps.googleusercontent.com";
const CALENDAR = "https://www.googleapis.com/auth/calendar.events";
const TASKS = "https://www.googleapis.com/auth/tasks";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Captures the single request a helper makes. */
function mockFetch(res: Response) {
  const fetchImpl = vi.fn().mockResolvedValue(res);
  const sent = () => {
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    return { url: new URL(url), init, body: init.body as URLSearchParams };
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, mock: fetchImpl, sent };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function idToken(claims: Record<string, unknown>): string {
  return [base64url({ alg: "RS256", typ: "JWT" }), base64url(claims), "sig"].join(".");
}

const CLAIMS = {
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "1098765",
  email: "dana@firm.com",
  email_verified: true,
  hd: "firm.com",
};

const TOKEN_BODY = {
  token_type: "Bearer",
  access_token: "AT",
  refresh_token: "RT",
  expires_in: 3599,
  scope: `openid ${CALENDAR} ${TASKS}`,
  id_token: "ID",
};
// JSON.stringify drops undefined keys, so these serialize without the field.
const TOKEN_BODY_NO_REFRESH = { ...TOKEN_BODY, refresh_token: undefined };
const TOKEN_BODY_NO_ID_TOKEN = { ...TOKEN_BODY, id_token: undefined };

describe("google oauth helpers", () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "csecret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    consoleSpies = (["error", "warn", "log", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Every argument any console method received, rendered deeply (an Error with its message and stack). */
  function everythingLogged(): string {
    return consoleSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => inspect(arg, { depth: null }))
      .join("\n");
  }

  it("authorize URL asks Google for offline access, a fresh consent and an account picker, with PKCE", () => {
    const url = new URL(buildAuthorizeUrl({ state: "s1", challenge: "chal" }));

    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/workspace/google/callback");
    expect(url.searchParams.get("scope")).toBe(`openid email profile ${CALENDAR} ${TASKS}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  it("authorize URL carries login_hint when given", () => {
    const url = new URL(buildAuthorizeUrl({ state: "s1", challenge: "chal", loginHint: "dana@firm.com" }));
    expect(url.searchParams.get("login_hint")).toBe("dana@firm.com");
  });

  it("exchangeCode posts the code grant to Google's token endpoint and maps the token set", async () => {
    const { fetchImpl, sent } = mockFetch(jsonResponse(200, TOKEN_BODY));
    const tokens = await exchangeCode({ code: "auth-code", codeVerifier: "verifier" }, fetchImpl);

    const { url, init, body } = sent();
    expect(url.toString()).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("redirect_uri")).toBe("https://app.test/api/workspace/google/callback");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe("csecret");

    expect(tokens).toEqual({
      accessToken: "AT",
      refreshToken: "RT",
      expiresInSec: 3599,
      scope: `openid ${CALENDAR} ${TASKS}`,
      idToken: "ID",
    });
  });

  it("a sign-in that returns no refresh token rejects with missing_refresh_token", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(200, TOKEN_BODY_NO_REFRESH));
    const err = await exchangeCode({ code: "auth-code", codeVerifier: "verifier" }, fetchImpl).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("missing_refresh_token");
  });

  it("a sign-in that returns no id_token rejects with missing_id_token", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(200, TOKEN_BODY_NO_ID_TOKEN));
    const err = await exchangeCode({ code: "auth-code", codeVerifier: "verifier" }, fetchImpl).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("missing_id_token");
  });

  it("refreshTokens posts the refresh grant", async () => {
    const { fetchImpl, sent } = mockFetch(jsonResponse(200, { ...TOKEN_BODY, refresh_token: "new-rt" }));
    const tokens = await refreshTokens({ refreshToken: "old-rt" }, fetchImpl);

    const { url, body } = sent();
    expect(url.toString()).toBe("https://oauth2.googleapis.com/token");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-rt");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe("csecret");
    expect(tokens.refreshToken).toBe("new-rt");
  });

  it("a refresh that returns no refresh token keeps the one it was given", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(200, TOKEN_BODY_NO_REFRESH));
    const tokens = await refreshTokens({ refreshToken: "old-rt" }, fetchImpl);

    expect(tokens.accessToken).toBe("AT");
    expect(tokens.refreshToken).toBe("old-rt");
  });

  it("Google's error rejects GoogleAuthError with its code; error_description never reaches the error or a log", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(400, { error: "invalid_grant", error_description: "secret" }));
    const err = await refreshTokens({ refreshToken: "old-rt" }, fetchImpl).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("invalid_grant");
    expect(inspect(err, { depth: null })).not.toContain("secret");
    expect(everythingLogged()).not.toContain("secret");
  });

  it("a non-JSON error body rejects token_request_failed without quoting the body", async () => {
    const { fetchImpl } = mockFetch(new Response("<html>gateway secret</html>", { status: 502 }));
    const err = await refreshTokens({ refreshToken: "old-rt" }, fetchImpl).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("token_request_failed");
    expect(inspect(err, { depth: null })).not.toContain("secret");
    expect(everythingLogged()).not.toContain("secret");
  });

  it("a 200 without an access token rejects invalid_token_response", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(200, { ...TOKEN_BODY, access_token: undefined }));
    const err = await refreshTokens({ refreshToken: "old-rt" }, fetchImpl).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("invalid_token_response");
  });

  it("readIdTokenClaims reads subject, email and hosted domain for a Google Workspace account", () => {
    expect(readIdTokenClaims(idToken(CLAIMS))).toEqual({
      subject: "1098765",
      email: "dana@firm.com",
      hostedDomain: "firm.com",
    });
  });

  it("readIdTokenClaims gives a personal Gmail account hostedDomain null", () => {
    // JSON.stringify drops undefined keys, so this payload has no `hd` claim.
    expect(readIdTokenClaims(idToken({ ...CLAIMS, hd: undefined, email: "dana@gmail.com" }))).toEqual({
      subject: "1098765",
      email: "dana@gmail.com",
      hostedDomain: null,
    });
  });

  it("readIdTokenClaims accepts the bare accounts.google.com issuer", () => {
    expect(readIdTokenClaims(idToken({ ...CLAIMS, iss: "accounts.google.com" })).subject).toBe("1098765");
  });

  it.each([
    ["another client's audience", { ...CLAIMS, aud: "other.apps.googleusercontent.com" }],
    ["no audience", { ...CLAIMS, aud: undefined }],
    ["another issuer", { ...CLAIMS, iss: "https://evil.test" }],
    ["no issuer", { ...CLAIMS, iss: undefined }],
    ["no subject", { ...CLAIMS, sub: undefined }],
    ["no email", { ...CLAIMS, email: undefined }],
  ])("readIdTokenClaims rejects %s with invalid_id_token", (_label, claims) => {
    const err = (() => {
      try {
        return readIdTokenClaims(idToken(claims));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("invalid_id_token");
  });

  it.each([
    ["not a JWT", "not-a-jwt"],
    ["a payload that isn't base64url JSON", "a.!!!not-json!!!.c"],
    ["a payload that is a JSON array", `h.${base64url([CLAIMS])}.s`],
    ["an empty string", ""],
  ])("readIdTokenClaims turns %s into invalid_id_token, never a raw parse error", (_label, token) => {
    expect(() => readIdTokenClaims(token)).toThrow(GoogleAuthError);
  });

  it("hasRequiredScopes needs both the calendar.events and tasks scopes, whole", () => {
    expect(hasRequiredScopes(`openid https://www.googleapis.com/auth/userinfo.email ${CALENDAR} ${TASKS}`)).toBe(true);
    expect(hasRequiredScopes(`openid ${CALENDAR}`)).toBe(false);
    expect(hasRequiredScopes(`openid ${TASKS}`)).toBe(false);
    expect(hasRequiredScopes(`${CALENDAR} ${TASKS}.readonly`)).toBe(false);
    expect(hasRequiredScopes(`${CALENDAR}.readonly ${TASKS}`)).toBe(false);
    expect(hasRequiredScopes("")).toBe(false);
  });

  it("revokeToken posts the token to Google's revoke endpoint", async () => {
    const { fetchImpl, sent } = mockFetch(new Response(null, { status: 200 }));
    await revokeToken("RT-to-revoke", fetchImpl);

    const { url, init, body } = sent();
    expect(url.toString()).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(body.get("token")).toBe("RT-to-revoke");
    expect(everythingLogged()).toBe("");
  });

  it("a refused revoke resolves and logs the status only, never the token or the body", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(400, { error: "invalid_token", error_description: "secret" }));

    await expect(revokeToken("RT-to-revoke", fetchImpl)).resolves.toBeUndefined();

    const logged = everythingLogged();
    expect(logged).toContain("400");
    expect(logged).not.toContain("RT-to-revoke");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("invalid_token");
  });

  it("a revoke whose request throws resolves without logging the token or the error's message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed: secret")) as unknown as typeof fetch;

    await expect(revokeToken("RT-to-revoke", fetchImpl)).resolves.toBeUndefined();

    const logged = everythingLogged();
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("RT-to-revoke");
    expect(logged).not.toContain("secret");
  });
});
