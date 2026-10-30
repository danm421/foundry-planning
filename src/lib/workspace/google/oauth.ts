// src/lib/workspace/google/oauth.ts
import { discardBody, postTokenRequest, readJwtPayload, stringField, type TokenResponse } from "../provider-http";
import type { ProviderTokenSet } from "../types";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_SCOPES,
  GOOGLE_TASKS_SCOPE,
  GOOGLE_USER_REDIRECT_PATH,
  googleAppConfig,
} from "./config";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Google signs id_tokens under either spelling of its issuer. */
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/**
 * A token-endpoint or id_token failure. `code` is Google's `error` field
 * (`invalid_grant`, `invalid_client`, …) or one of ours
 * (`missing_refresh_token`, `missing_id_token`, `token_request_failed`,
 * `invalid_token_response`, `invalid_id_token`). The message never carries the
 * response body or `error_description`.
 */
export class GoogleAuthError extends Error {
  constructor(
    public readonly code: string,
    status?: number,
  ) {
    super(`Google sign-in failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "GoogleAuthError";
  }
}

/** The id_token claims Foundry keys a Google connection on. `hostedDomain` is null for a personal Gmail. */
export type GoogleIdTokenClaims = {
  subject: string;
  email: string;
  hostedDomain: string | null;
};

function redirectUri(): string {
  return new URL(GOOGLE_USER_REDIRECT_PATH, googleAppConfig().appUrl).toString();
}

/**
 * An advisor's sign-in. `access_type=offline` asks for a refresh token, and
 * `consent` makes Google send one on every sign-in, a reconnect included
 * (otherwise only the first grant gets one). `select_account` lets an advisor
 * signed in to several Google accounts pick which one to connect.
 */
export function buildAuthorizeUrl(opts: {
  state: string;
  challenge: string;
  loginHint?: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", googleAppConfig().clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

/**
 * First sign-in. Without a refresh token the connection would die with its
 * first access token, and without an id_token there is no account to key it
 * on, so a response missing either is refused here.
 */
export async function exchangeCode(
  opts: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderTokenSet> {
  const tokens = await tokenRequest(
    {
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: redirectUri(),
      code_verifier: opts.codeVerifier,
    },
    fetchImpl,
  );
  if (!tokens.refreshToken) throw new GoogleAuthError("missing_refresh_token");
  if (!tokens.idToken) throw new GoogleAuthError("missing_id_token");
  return { ...tokens, refreshToken: tokens.refreshToken };
}

/**
 * Google doesn't rotate refresh tokens: a refresh response normally carries
 * none, and the token we sent stays valid, so it is carried forward.
 */
export async function refreshTokens(
  opts: { refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderTokenSet> {
  const tokens = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: opts.refreshToken },
    fetchImpl,
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? opts.refreshToken };
}

function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleAppConfig();
  return postTokenRequest(
    TOKEN_URL,
    { ...params, client_id: clientId, client_secret: clientSecret },
    fetchImpl,
    GoogleAuthError,
  );
}

/**
 * Reads the id_token payload WITHOUT verifying its signature. Acceptable only
 * because the token came straight from Google's token endpoint over TLS, in
 * exchange for our client secret: TLS server validation stands in for the
 * signature check (OIDC Core §3.1.3.7). Never call this on an id_token that
 * arrived any other way (a browser redirect, a request body). The audience and
 * issuer are still checked, so a token minted for another client is refused.
 */
export function readIdTokenClaims(idToken: string): GoogleIdTokenClaims {
  const payload = readJwtPayload(idToken);
  const subject = stringField(payload, "sub");
  const email = stringField(payload, "email");
  const issuer = stringField(payload, "iss");
  if (
    !subject ||
    !email ||
    !issuer ||
    !ISSUERS.has(issuer) ||
    payload.aud !== googleAppConfig().clientId
  ) {
    throw new GoogleAuthError("invalid_id_token");
  }
  return { subject, email, hostedDomain: stringField(payload, "hd") };
}

/**
 * Google's consent screen lets the advisor untick either data scope, and
 * Workspace needs both. Whole scopes are compared, so `tasks.readonly` doesn't
 * pass for `tasks`.
 */
export function hasRequiredScopes(scope: string): boolean {
  const granted = new Set(scope.split(/\s+/));
  return granted.has(GOOGLE_CALENDAR_SCOPE) && granted.has(GOOGLE_TASKS_SCOPE);
}

/**
 * Withdraws the grant; revoking the refresh token also revokes its access
 * tokens. Best effort on a path that is already finishing, so it never throws.
 * A failure logs Google's HTTP status (or, for a network failure, the error's
 * name) and nothing else: no token, no body.
 */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    await discardBody(res);
    if (!res.ok) console.error("Google token revoke failed:", { status: res.status });
  } catch (err) {
    console.error("Google token revoke failed:", { name: err instanceof Error ? err.name : typeof err });
  }
}
