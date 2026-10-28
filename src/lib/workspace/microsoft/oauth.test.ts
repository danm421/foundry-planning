// src/lib/workspace/microsoft/oauth.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAdminConsentUrl,
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  readIdTokenClaims,
  MicrosoftAuthError,
} from "./oauth";
import { microsoftAppConfig } from "./config";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Captures the single token request a helper makes. */
function mockFetch(res: Response) {
  const fetchImpl = vi.fn().mockResolvedValue(res);
  const sent = () => {
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    return { url: new URL(url), init, body: init.body as URLSearchParams };
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, sent };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const TOKEN_BODY = {
  token_type: "Bearer",
  access_token: "AT",
  refresh_token: "RT",
  expires_in: 3599,
  scope: "https://graph.microsoft.com/Calendars.ReadWrite",
  id_token: "ID",
};
// JSON.stringify drops undefined keys, so this serializes with no refresh_token.
const TOKEN_BODY_NO_REFRESH = { ...TOKEN_BODY, refresh_token: undefined };

describe("microsoft oauth helpers", () => {
  beforeEach(() => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "cid");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "csecret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("microsoftAppConfig names the missing env var", () => {
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
    expect(() => microsoftAppConfig()).toThrow("MICROSOFT_CLIENT_SECRET is not set");
  });

  it("admin-consent URL asks the organizations endpoint for exactly the delegated scopes", () => {
    const url = new URL(buildAdminConsentUrl({ state: "s1" }));
    expect(url.host).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/organizations/v2.0/adminconsent");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.test/api/workspace/microsoft/admin-consent/callback",
    );
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toContain("https://graph.microsoft.com/Calendars.ReadWrite");
    expect(scopes).toContain("https://graph.microsoft.com/MailboxSettings.Read");
    expect(scopes).toContain("offline_access");
    expect(url.searchParams.get("scope")).not.toContain("Mail.Read");
  });

  it("authorize URL targets the firm's tenant with PKCE and an account picker", () => {
    const url = new URL(buildAuthorizeUrl({ tenantId: "t-123", state: "s2", challenge: "c" }));
    expect(url.host).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/t-123/oauth2/v2.0/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("code_challenge")).toBe("c");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("state")).toBe("s2");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.test/api/workspace/microsoft/callback",
    );
  });

  it("exchangeCode posts the code grant to the tenant's token endpoint and maps the token set", async () => {
    const { fetchImpl, sent } = mockFetch(jsonResponse(200, TOKEN_BODY));
    const tokens = await exchangeCode(
      { tenantId: "t-123", code: "auth-code", codeVerifier: "verifier" },
      fetchImpl,
    );

    const { url, init, body } = sent();
    expect(url.host).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/t-123/oauth2/v2.0/token");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("csecret");
    expect(body.get("redirect_uri")).toBe("https://app.test/api/workspace/microsoft/callback");

    expect(tokens).toEqual({
      accessToken: "AT",
      refreshToken: "RT",
      expiresInSec: 3599,
      scope: "https://graph.microsoft.com/Calendars.ReadWrite",
      idToken: "ID",
    });
  });

  it("a Microsoft error rejects with its code and keeps error_description out of the message", async () => {
    const { fetchImpl } = mockFetch(
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "AADSTS70008: The refresh token has expired … secret detail",
      }),
    );
    const err = await exchangeCode(
      { tenantId: "t-123", code: "auth-code", codeVerifier: "verifier" },
      fetchImpl,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MicrosoftAuthError);
    expect((err as MicrosoftAuthError).code).toBe("invalid_grant");
    expect((err as MicrosoftAuthError).message).not.toContain("secret detail");
    expect((err as MicrosoftAuthError).message).not.toContain("AADSTS70008");
  });

  it("a non-JSON error body rejects without quoting the body", async () => {
    const { fetchImpl } = mockFetch(new Response("<html>gateway secret</html>", { status: 502 }));
    const err = await refreshTokens({ tenantId: "t-123", refreshToken: "old-rt" }, fetchImpl).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(MicrosoftAuthError);
    expect((err as MicrosoftAuthError).code).toBe("token_request_failed");
    expect((err as MicrosoftAuthError).message).not.toContain("gateway secret");
  });

  it("a sign-in that returns no refresh token rejects with missing_refresh_token", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(200, TOKEN_BODY_NO_REFRESH));
    const err = await exchangeCode(
      { tenantId: "t-123", code: "auth-code", codeVerifier: "verifier" },
      fetchImpl,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MicrosoftAuthError);
    expect((err as MicrosoftAuthError).code).toBe("missing_refresh_token");
  });

  it("refreshTokens posts the refresh grant and returns the rotated refresh token", async () => {
    const { fetchImpl, sent } = mockFetch(jsonResponse(200, { ...TOKEN_BODY, refresh_token: "new-rt" }));
    const tokens = await refreshTokens({ tenantId: "t-123", refreshToken: "old-rt" }, fetchImpl);

    const { url, body } = sent();
    expect(url.pathname).toBe("/t-123/oauth2/v2.0/token");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-rt");
    expect(body.get("client_secret")).toBe("csecret");
    expect(tokens.refreshToken).toBe("new-rt");
  });

  it("a refresh that returns no refresh token keeps the one it was given", async () => {
    const { fetchImpl } = mockFetch(jsonResponse(200, TOKEN_BODY_NO_REFRESH));
    const tokens = await refreshTokens({ tenantId: "t-123", refreshToken: "old-rt" }, fetchImpl);

    expect(tokens.accessToken).toBe("AT");
    expect(tokens.refreshToken).toBe("old-rt");
  });

  it("readIdTokenClaims reads tenant, object id and email from the payload", () => {
    const idToken = [
      base64url({ alg: "none", typ: "JWT" }),
      base64url({ tid: "t-123", oid: "o-1", preferred_username: "dana@firm.com" }),
      "",
    ].join(".");

    expect(readIdTokenClaims(idToken)).toEqual({
      tenantId: "t-123",
      userObjectId: "o-1",
      email: "dana@firm.com",
    });
  });

  it("readIdTokenClaims throws on a malformed token", () => {
    expect(() => readIdTokenClaims("not-a-jwt")).toThrow(MicrosoftAuthError);
    expect(() => readIdTokenClaims("a.!!!not-json!!!.c")).toThrow(MicrosoftAuthError);
    expect(() =>
      readIdTokenClaims(`h.${base64url({ tid: "t-123", preferred_username: "dana@firm.com" })}.s`),
    ).toThrow(MicrosoftAuthError);
  });
});
