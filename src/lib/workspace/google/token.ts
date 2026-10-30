// src/lib/workspace/google/token.ts
import { accessTokenGetter } from "../access-token";
import { GoogleAuthError, refreshTokens } from "./oauth";

/**
 * A usable Google access token for a connection (see `accessTokenGetter`).
 * `refreshTokens` already keeps the old refresh token, which Google doesn't
 * rotate. Only `invalid_grant` (a revoked or expired sign-in) needs a reconnect.
 */
export const getAccessToken = accessTokenGetter({
  refresh: (conn) => refreshTokens({ refreshToken: conn.refreshToken }),
  reconnectCode: (err) => (err instanceof GoogleAuthError && err.code === "invalid_grant" ? err.code : null),
});
