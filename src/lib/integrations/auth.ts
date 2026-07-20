// src/lib/integrations/auth.ts
import { getConnection, setConnectionStatus, upsertConnection } from "./connections";
import { ReconnectRequired } from "./errors";
import { getProvider } from "./registry";
import type { ProviderCallContext, ProviderId, TokenResponse } from "./types";

const SKEW_MS = 60_000;

/** test seam — overrides the registry's refresh for every provider */
let refresher: ((providerId: ProviderId, rt: string) => Promise<TokenResponse>) | null = null;
export function __setRefresher(
  fn: ((providerId: ProviderId, rt: string) => Promise<TokenResponse>) | null,
): void {
  refresher = fn;
}

export async function getValidAccessToken(
  firmId: string,
  providerId: ProviderId,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const conn = await getConnection(firmId, providerId);
  if (!conn || conn.status === "disconnected" || !conn.accessToken) {
    throw new ReconnectRequired(firmId, providerId);
  }
  const expired = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - SKEW_MS < Date.now();
  if (!expired && !opts?.forceRefresh) return conn.accessToken;

  if (!conn.refreshToken) throw new ReconnectRequired(firmId, providerId);
  try {
    const t = refresher
      ? await refresher(providerId, conn.refreshToken)
      : await getProvider(providerId).oauth.refreshTokens(conn.refreshToken);
    await upsertConnection({
      firmId,
      providerId,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? conn.refreshToken, // handle rotation
      expiresAt: t.expiresInSec ? new Date(Date.now() + t.expiresInSec * 1000) : null,
      scope: t.scope ?? conn.scope,
      userId: `system:${providerId}-refresh`,
    });
    return t.accessToken;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    await setConnectionStatus(firmId, providerId, "error", cause);
    throw new ReconnectRequired(firmId, providerId);
  }
}

/** Builds the context every provider client read takes. */
export function makeCallContext(
  firmId: string,
  providerId: ProviderId,
  overrides?: { fetchImpl?: typeof fetch; baseUrl?: string },
): ProviderCallContext {
  return {
    firmId,
    providerId,
    getToken: (opts) => getValidAccessToken(firmId, providerId, opts),
    fetchImpl: overrides?.fetchImpl,
    baseUrl: overrides?.baseUrl,
  };
}
