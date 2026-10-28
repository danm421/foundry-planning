// src/lib/workspace/microsoft/token.ts
import { markNeedsReconnect, storeRefreshedTokens, type WorkspaceConnection } from "../connections";
import { WorkspaceReconnectRequiredError } from "../errors";
import { MicrosoftAuthError, refreshTokens } from "./oauth";

/** Refresh a little early so a token can't expire between the check and Graph. */
const EXPIRY_SKEW_MS = 60_000;

/** Microsoft's answers that only a fresh sign-in can fix. */
const RECONNECT_CODES = new Set(["invalid_grant", "interaction_required"]);

/**
 * A usable access token for `conn`: the stored one, unless it expires within
 * 60 s or `forceRefresh` is set (Graph said 401). A refresh is stored and
 * written back onto `conn`, so later calls with the same connection reuse it
 * instead of refreshing again. `refreshTokens` already keeps the old refresh
 * token when Microsoft returns none.
 *
 * A revoked or expired sign-in marks the connection `needs_reconnect` and
 * throws `WorkspaceReconnectRequiredError`. Every other failure (an outage,
 * a network error, a DB error) propagates unchanged.
 */
export async function getAccessToken(
  conn: WorkspaceConnection,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  if (!opts.forceRefresh && conn.tokenExpiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) {
    return conn.accessToken;
  }

  let tokens;
  try {
    tokens = await refreshTokens({ tenantId: conn.tenantId, refreshToken: conn.refreshToken });
  } catch (err) {
    if (err instanceof MicrosoftAuthError && RECONNECT_CODES.has(err.code)) {
      await markNeedsReconnect(conn.id, err.code);
      throw new WorkspaceReconnectRequiredError();
    }
    throw err;
  }

  await storeRefreshedTokens(conn.id, tokens);
  conn.accessToken = tokens.accessToken;
  conn.refreshToken = tokens.refreshToken;
  conn.tokenExpiresAt = new Date(Date.now() + tokens.expiresInSec * 1000);
  return tokens.accessToken;
}
