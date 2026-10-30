// src/lib/workspace/microsoft/token.ts
import { accessTokenGetter } from "../access-token";
import { MicrosoftAuthError, refreshTokens } from "./oauth";

/** Microsoft's answers that only a fresh sign-in can fix. */
const RECONNECT_CODES = new Set(["invalid_grant", "interaction_required"]);

/**
 * A usable Graph access token for a connection (see `accessTokenGetter`),
 * refreshed on the connection's own tenant. `refreshTokens` already keeps the
 * old refresh token when Microsoft returns none.
 */
export const getAccessToken = accessTokenGetter({
  refresh: (conn) => refreshTokens({ tenantId: conn.tenantId, refreshToken: conn.refreshToken }),
  reconnectCode: (err) => (err instanceof MicrosoftAuthError && RECONNECT_CODES.has(err.code) ? err.code : null),
});
