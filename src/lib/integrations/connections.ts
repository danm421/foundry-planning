// src/lib/integrations/connections.ts
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, integrationOauthStates } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { ProviderId } from "./types";

export type IntegrationConnectionRow = {
  firmId: string;
  providerId: ProviderId;
  status: "connected" | "disconnected" | "error";
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenEnc: string;
  tokenExpiresAt: Date | null;
  scope: string | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
};

export async function upsertConnection(input: {
  firmId: string;
  providerId: ProviderId;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
  userId: string;
}): Promise<void> {
  const values = {
    firmId: input.firmId,
    provider: input.providerId,
    accessTokenEnc: encryptSecret(input.accessToken),
    refreshTokenEnc: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    tokenExpiresAt: input.expiresAt ?? null,
    scope: input.scope ?? null,
    status: "connected" as const,
    lastSyncError: null,
    connectedByUserId: input.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(integrationConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [integrationConnections.firmId, integrationConnections.provider],
      set: values,
    });
}

/** Stores BYOK credentials (Addepar): the encoded secret blob is encrypted into
 * `accessTokenEnc`; the encoded config blob (apiBase/addeparFirmId) is stored
 * plaintext in `scope`, mirroring how OAuth providers stash their token scope. */
export async function upsertByokConnection(input: {
  firmId: string;
  providerId: ProviderId;
  secretBlob: string;   // JSON {apiKey, apiSecret}
  configBlob: string;   // JSON {apiBase, addeparFirmId}
  userId: string;
}): Promise<void> {
  const values = {
    firmId: input.firmId,
    provider: input.providerId,
    accessTokenEnc: encryptSecret(input.secretBlob),
    refreshTokenEnc: null,
    tokenExpiresAt: null,
    scope: input.configBlob,
    status: "connected" as const,
    lastSyncError: null,
    connectedByUserId: input.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(integrationConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [integrationConnections.firmId, integrationConnections.provider],
      set: values,
    });
}

export async function getConnection(
  firmId: string,
  providerId: ProviderId,
): Promise<IntegrationConnectionRow | null> {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.firmId, firmId),
        eq(integrationConnections.provider, providerId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    firmId: row.firmId,
    providerId: row.provider,
    status: row.status,
    accessToken: row.accessTokenEnc ? decryptSecret(row.accessTokenEnc) : null,
    refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null,
    accessTokenEnc: row.accessTokenEnc,
    tokenExpiresAt: row.tokenExpiresAt,
    scope: row.scope,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
  };
}

export async function setConnectionStatus(
  firmId: string,
  providerId: ProviderId,
  status: "connected" | "disconnected" | "error",
  error?: string | null,
  extra?: { lastSyncedAt?: Date },
): Promise<void> {
  await db
    .update(integrationConnections)
    .set({
      status,
      lastSyncError: error ?? null,
      updatedAt: new Date(),
      ...(extra?.lastSyncedAt ? { lastSyncedAt: extra.lastSyncedAt } : {}),
    })
    .where(
      and(
        eq(integrationConnections.firmId, firmId),
        eq(integrationConnections.provider, providerId),
      ),
    );
}

export async function disconnectConnection(
  firmId: string,
  providerId: ProviderId,
): Promise<void> {
  await db
    .update(integrationConnections)
    .set({
      status: "disconnected",
      accessTokenEnc: "",
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationConnections.firmId, firmId),
        eq(integrationConnections.provider, providerId),
      ),
    );
}

/** Every connected (firm, provider) pair — the cron's work list. */
export async function listConnectedFirms(): Promise<
  Array<{ firmId: string; providerId: ProviderId }>
> {
  const rows = await db
    .select({
      firmId: integrationConnections.firmId,
      provider: integrationConnections.provider,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.status, "connected"));
  return rows.map((r) => ({ firmId: r.firmId, providerId: r.provider }));
}

export async function createOauthState(input: {
  firmId: string;
  providerId: ProviderId;
  userId: string;
  state: string;
  codeVerifier: string;
  ttlMs: number;
}): Promise<void> {
  await db.insert(integrationOauthStates).values({
    firmId: input.firmId,
    provider: input.providerId,
    userId: input.userId,
    state: input.state,
    codeVerifier: input.codeVerifier,
    expiresAt: new Date(Date.now() + input.ttlMs),
  });
}

export async function consumeOauthState(state: string): Promise<{
  firmId: string;
  providerId: ProviderId;
  userId: string;
  codeVerifier: string;
} | null> {
  const [row] = await db
    .delete(integrationOauthStates)
    .where(
      and(
        eq(integrationOauthStates.state, state),
        gt(integrationOauthStates.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) {
    // Clean up an expired-but-present row so it can't linger.
    await db.delete(integrationOauthStates).where(eq(integrationOauthStates.state, state));
    return null;
  }
  return {
    firmId: row.firmId,
    providerId: row.provider,
    userId: row.userId,
    codeVerifier: row.codeVerifier,
  };
}
