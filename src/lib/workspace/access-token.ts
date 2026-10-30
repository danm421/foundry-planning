// src/lib/workspace/access-token.ts
import { markNeedsReconnect, storeRefreshedTokens, type WorkspaceConnection } from "./connections";
import { WorkspaceReconnectRequiredError } from "./errors";
import type { ProviderTokenSet } from "./types";

/** Refresh a little early so a token can't expire between the check and the provider. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * A provider's `getAccessToken(conn, opts)`: the stored token, unless it
 * expires within 60 s or `forceRefresh` is set (the provider said 401). A
 * refresh is stored and written back onto `conn`, so later calls with the same
 * connection reuse it instead of refreshing again.
 *
 * When `refresh` fails with an error `reconnectCode` names (a revoked or
 * expired sign-in), the connection is marked `needs_reconnect` and
 * `WorkspaceReconnectRequiredError` is thrown. Every other failure (an outage,
 * a network error, a DB error) propagates unchanged.
 */
export function accessTokenGetter(provider: {
  refresh: (conn: WorkspaceConnection) => Promise<ProviderTokenSet>;
  /** The error's code when only a fresh sign-in can fix it, else null. */
  reconnectCode: (err: unknown) => string | null;
}) {
  return async function getAccessToken(
    conn: WorkspaceConnection,
    opts: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    if (!opts.forceRefresh && conn.tokenExpiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) {
      return conn.accessToken;
    }

    let tokens;
    try {
      tokens = await provider.refresh(conn);
    } catch (err) {
      const code = provider.reconnectCode(err);
      if (code !== null) {
        await markNeedsReconnect(conn.id, code);
        throw new WorkspaceReconnectRequiredError();
      }
      throw err;
    }

    await storeRefreshedTokens(conn.id, tokens);
    conn.accessToken = tokens.accessToken;
    conn.refreshToken = tokens.refreshToken;
    conn.tokenExpiresAt = new Date(Date.now() + tokens.expiresInSec * 1000);
    return tokens.accessToken;
  };
}
