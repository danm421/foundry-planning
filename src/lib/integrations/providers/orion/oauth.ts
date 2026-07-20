// src/lib/integrations/providers/orion/oauth.ts
import { createHash, randomBytes } from "node:crypto";

import { requireEnv } from "../../env";
import type { ProviderOAuth, TokenResponse } from "../../types";

const TOKEN_PATH = "/oauth/token"; // FINALIZE against Orion docs
const AUTHORIZE_PATH = "/oauth/authorize"; // FINALIZE against Orion docs
const SCOPE = "read"; // FINALIZE against Orion docs

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildAuthorizeUrl(opts: { state: string; challenge: string }): string {
  const base = requireEnv("ORION_API_BASE");
  const url = new URL(AUTHORIZE_PATH, base);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requireEnv("ORION_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("ORION_REDIRECT_URI"));
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCodeForTokens(
  opts: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: requireEnv("ORION_REDIRECT_URI"),
      code_verifier: opts.codeVerifier,
    },
    fetchImpl,
  );
}

export async function refreshTokens(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl,
  );
}

async function tokenRequest(
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    ...params,
    client_id: requireEnv("ORION_CLIENT_ID"),
    client_secret: requireEnv("ORION_CLIENT_SECRET"),
  });
  const res = await fetchImpl(new URL(TOKEN_PATH, requireEnv("ORION_API_BASE")).toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Orion token request failed: ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresInSec: json.expires_in ? Number(json.expires_in) : undefined,
    scope: json.scope ? String(json.scope) : undefined,
  };
}

export const orionOAuth: ProviderOAuth = {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
};
