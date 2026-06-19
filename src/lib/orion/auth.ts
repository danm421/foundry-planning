// src/lib/orion/auth.ts
import { getConnection, upsertConnection, setConnectionStatus } from "./connections";
import { refreshTokens, type OrionTokenResponse } from "./oauth";

export class OrionReconnectRequired extends Error {
  constructor(public firmId: string) {
    super(`Orion connection for ${firmId} needs to be re-authorized`);
    this.name = "OrionReconnectRequired";
  }
}

const SKEW_MS = 60_000;
let refresher: (rt: string) => Promise<OrionTokenResponse> = refreshTokens;
/** test seam */
export function __setRefresher(fn: (rt: string) => Promise<OrionTokenResponse>): void {
  refresher = fn;
}

export async function getValidAccessToken(
  firmId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const conn = await getConnection(firmId);
  if (!conn || conn.status === "disconnected" || !conn.accessToken) {
    throw new OrionReconnectRequired(firmId);
  }
  const expired = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - SKEW_MS < Date.now();
  if (!expired && !opts?.forceRefresh) return conn.accessToken;

  if (!conn.refreshToken) throw new OrionReconnectRequired(firmId);
  try {
    const t = await refresher(conn.refreshToken);
    await upsertConnection({
      firmId,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? conn.refreshToken, // handle rotation
      expiresAt: t.expiresInSec ? new Date(Date.now() + t.expiresInSec * 1000) : null,
      scope: t.scope ?? conn.scope,
      userId: "system:orion-refresh",
    });
    return t.accessToken;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    await setConnectionStatus(firmId, "error", cause);
    throw new OrionReconnectRequired(firmId);
  }
}
