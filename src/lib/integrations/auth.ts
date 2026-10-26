// src/lib/integrations/auth.ts
import {
  loadConnection,
  setConnectionStatusById,
  storeRefreshedTokens,
  type IntegrationConnectionRow,
} from "./connections";
import { ReconnectRequired } from "./errors";
import { decodeAddeparConfig } from "./providers/addepar/credentials";
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

/**
 * The connection's access token, refreshed first when it's expired (or
 * `forceRefresh`). A refresh is stored with `storeRefreshedTokens`, which
 * never touches the owner. A failed refresh marks the connection `error`.
 */
async function accessTokenFor(
  conn: IntegrationConnectionRow,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const { firmId, providerId } = conn;
  if (conn.status === "disconnected" || !conn.accessToken) {
    throw new ReconnectRequired(firmId, providerId);
  }
  const expired = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - SKEW_MS < Date.now();
  if (!expired && !opts?.forceRefresh) return conn.accessToken;

  if (!conn.refreshToken) throw new ReconnectRequired(firmId, providerId);
  try {
    const provider = getProvider(providerId);
    let t: TokenResponse;
    if (refresher) {
      t = await refresher(providerId, conn.refreshToken);
    } else {
      // BYOK contexts never reach here (their getToken is static); a
      // non-oauth provider here is a bug, not a runtime state.
      if (!provider.oauth) throw new Error("oauth refresh called for non-oauth provider");
      t = await provider.oauth.refreshTokens(conn.refreshToken);
    }
    await storeRefreshedTokens(conn.id, {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? conn.refreshToken, // handle rotation
      expiresAt: t.expiresInSec ? new Date(Date.now() + t.expiresInSec * 1000) : null,
      scope: t.scope ?? conn.scope,
    });
    return t.accessToken;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    await setConnectionStatusById(conn.id, "error", cause);
    throw new ReconnectRequired(firmId, providerId);
  }
}

async function loadOrThrow(connectionId: string): Promise<IntegrationConnectionRow> {
  const conn = await loadConnection(connectionId);
  if (!conn) throw new Error(`Integration connection ${connectionId} not found`);
  return conn;
}

/** A valid access token for one connection, refreshing it when needed. */
export async function getConnectionAccessToken(
  connectionId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  return accessTokenFor(await loadOrThrow(connectionId), opts);
}

/** Builds the context every provider client read takes, for one connection. */
export async function connectionCallContext(
  connectionId: string,
  overrides?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<ProviderCallContext> {
  const conn = await loadOrThrow(connectionId);
  const { firmId, providerId } = conn;
  if (getProvider(providerId).authKind === "byok") {
    if (!conn.accessToken) throw new ReconnectRequired(firmId, providerId);
    const token = conn.accessToken; // narrowed to string by the guard above
    return {
      connectionId,
      firmId,
      providerId,
      config: decodeAddeparConfig(conn.scope),
      getToken: async () => token, // static; ignores forceRefresh
      fetchImpl: overrides?.fetchImpl,
    };
  }
  return {
    connectionId,
    firmId,
    providerId,
    getToken: (opts) => getConnectionAccessToken(connectionId, opts),
    fetchImpl: overrides?.fetchImpl,
    baseUrl: overrides?.baseUrl,
  };
}
