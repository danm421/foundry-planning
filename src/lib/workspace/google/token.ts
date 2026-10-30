// src/lib/workspace/google/token.ts
import { markNeedsReconnect, storeRefreshedTokens, type WorkspaceConnection } from "../connections";
import { WorkspaceReconnectRequiredError } from "../errors";
import { GoogleAuthError, refreshTokens } from "./oauth";

/** Refresh a little early so a token can't expire between the check and Google. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * A usable access token for `conn`: the stored one, unless it expires within
 * 60 s or `forceRefresh` is set (Google said 401). A refresh is stored and
 * written back onto `conn`, so later calls with the same connection reuse it
 * instead of refreshing again. `refreshTokens` already keeps the old refresh
 * token, which Google doesn't rotate.
 *
 * A revoked or expired sign-in (`invalid_grant`) marks the connection
 * `needs_reconnect` and throws `WorkspaceReconnectRequiredError`. Every other
 * failure (an outage, a network error, a DB error) propagates unchanged.
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
    tokens = await refreshTokens({ refreshToken: conn.refreshToken });
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === "invalid_grant") {
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
