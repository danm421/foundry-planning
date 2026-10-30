// src/lib/workspace/microsoft/oauth.ts
import type { IdTokenClaims, ProviderTokenSet } from "../types";
import {
  ADMIN_CONSENT_REDIRECT_PATH,
  USER_REDIRECT_PATH,
  graphScopeParam,
  microsoftAppConfig,
} from "./config";

const LOGIN_HOST = "https://login.microsoftonline.com";

/**
 * Microsoft's multi-organization authority: any work or school account, never
 * a personal one. The advisor's organization comes back in the id_token.
 */
const ORGANIZATIONS = "organizations";

/**
 * A token-endpoint or id_token failure. `code` is Microsoft's `error` field
 * (`invalid_grant`, `interaction_required`, …) or one of ours
 * (`missing_refresh_token`, `token_request_failed`, `invalid_token_response`,
 * `invalid_id_token`). The message never carries the response body or
 * `error_description`, which can echo tenant, user and token detail into logs.
 */
export class MicrosoftAuthError extends Error {
  constructor(
    public readonly code: string,
    status?: number,
  ) {
    super(`Microsoft sign-in failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "MicrosoftAuthError";
  }
}

function redirectUri(path: string): string {
  return new URL(path, microsoftAppConfig().appUrl).toString();
}

/** A tenant id (or the `organizations` alias); encoded before it hits a path. */
function tenantUrl(tenantId: string, endpoint: "authorize" | "token"): string {
  return `${LOGIN_HOST}/${encodeURIComponent(tenantId)}/oauth2/v2.0/${endpoint}`;
}

/**
 * The link an advisor sends their IT admin: Microsoft's own admin-consent page
 * for Foundry, on the `organizations` endpoint so it works for any
 * organization. No state, so it never expires and names no firm; the callback
 * records nothing for it.
 */
export function buildItApprovalUrl(): string {
  const url = new URL(`${LOGIN_HOST}/${ORGANIZATIONS}/v2.0/adminconsent`);
  url.searchParams.set("client_id", microsoftAppConfig().clientId);
  url.searchParams.set("scope", graphScopeParam());
  url.searchParams.set("redirect_uri", redirectUri(ADMIN_CONSENT_REDIRECT_PATH));
  return url.toString();
}

/**
 * The same admin-consent page started from a firm's settings: the single-use
 * state ties the approval to the firm and admin who asked for it.
 */
export function buildAdminConsentUrl(opts: { state: string }): string {
  const url = new URL(buildItApprovalUrl());
  url.searchParams.set("state", opts.state);
  return url.toString();
}

/**
 * An advisor's own sign-in, at any organization. `loginHint` pre-fills the
 * address on a reconnect; the account picker still lets them choose another.
 */
export function buildAuthorizeUrl(opts: {
  state: string;
  challenge: string;
  loginHint?: string;
}): string {
  const url = new URL(tenantUrl(ORGANIZATIONS, "authorize"));
  url.searchParams.set("client_id", microsoftAppConfig().clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("redirect_uri", redirectUri(USER_REDIRECT_PATH));
  url.searchParams.set("scope", graphScopeParam());
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

/**
 * First sign-in, on the same `organizations` authority that issued the code.
 * Without a refresh token the connection would die with its first access
 * token, so a response missing one is refused here.
 */
export async function exchangeCode(
  opts: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderTokenSet> {
  const tokens = await tokenRequest(
    ORGANIZATIONS,
    {
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: redirectUri(USER_REDIRECT_PATH),
      code_verifier: opts.codeVerifier,
    },
    fetchImpl,
  );
  if (!tokens.refreshToken) throw new MicrosoftAuthError("missing_refresh_token");
  return { ...tokens, refreshToken: tokens.refreshToken };
}

/**
 * On the connection's own tenant (from its id_token). Microsoft normally
 * rotates the refresh token, but a refresh response may omit one (RFC 6749
 * §5.1); the token we sent stays valid then, so it is carried forward rather
 * than refused.
 */
export async function refreshTokens(
  opts: { tenantId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderTokenSet> {
  const tokens = await tokenRequest(
    opts.tenantId,
    { grant_type: "refresh_token", refresh_token: opts.refreshToken },
    fetchImpl,
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? opts.refreshToken };
}

async function tokenRequest(
  tenantId: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Omit<ProviderTokenSet, "refreshToken"> & { refreshToken: string | null }> {
  const { clientId, clientSecret } = microsoftAppConfig();
  const body = new URLSearchParams({
    ...params,
    client_id: clientId,
    client_secret: clientSecret,
    scope: graphScopeParam(),
  });
  const res = await fetchImpl(tenantUrl(tenantId, "token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = parseJsonObject(await res.text());
  if (!res.ok) {
    throw new MicrosoftAuthError(stringField(json, "error") ?? "token_request_failed", res.status);
  }
  const accessToken = stringField(json, "access_token");
  const expiresInSec = Number(json.expires_in);
  if (!accessToken || !Number.isFinite(expiresInSec)) {
    throw new MicrosoftAuthError("invalid_token_response", res.status);
  }
  return {
    accessToken,
    refreshToken: stringField(json, "refresh_token"),
    expiresInSec,
    scope: stringField(json, "scope") ?? "",
    idToken: stringField(json, "id_token"),
  };
}

/**
 * Reads the id_token payload WITHOUT verifying its signature. Acceptable only
 * because the token came straight from Microsoft's token endpoint over TLS, in
 * exchange for our client secret: TLS server validation stands in for the
 * signature check (OIDC Core §3.1.3.7). Never call this on an id_token that
 * arrived any other way (a browser redirect, a request body).
 */
export function readIdTokenClaims(idToken: string): IdTokenClaims {
  const parts = idToken.split(".");
  const payload =
    parts.length === 3 ? parseJsonObject(Buffer.from(parts[1], "base64url").toString("utf8")) : {};
  const tenantId = stringField(payload, "tid");
  const userObjectId = stringField(payload, "oid");
  const email = stringField(payload, "preferred_username");
  if (!tenantId || !userObjectId || !email) throw new MicrosoftAuthError("invalid_id_token");
  return { tenantId, userObjectId, email };
}

/** Never throws: a JSON parse error's message quotes the text it choked on. */
function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const json: unknown = JSON.parse(text);
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v !== "" ? v : null;
}
