// src/lib/orion/connections.ts
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { orionConnections, orionOauthStates } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";

export type OrionConnectionRow = {
  firmId: string;
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
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
  userId: string;
}): Promise<void> {
  const values = {
    firmId: input.firmId,
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
    .insert(orionConnections)
    .values(values)
    .onConflictDoUpdate({ target: orionConnections.firmId, set: values });
}

export async function getConnection(firmId: string): Promise<OrionConnectionRow | null> {
  const [row] = await db
    .select()
    .from(orionConnections)
    .where(eq(orionConnections.firmId, firmId))
    .limit(1);
  if (!row) return null;
  return {
    firmId: row.firmId,
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
  status: "connected" | "disconnected" | "error",
  error?: string | null,
): Promise<void> {
  await db
    .update(orionConnections)
    .set({ status, lastSyncError: error ?? null, updatedAt: new Date() })
    .where(eq(orionConnections.firmId, firmId));
}

export async function disconnectConnection(firmId: string): Promise<void> {
  await db
    .update(orionConnections)
    .set({
      status: "disconnected",
      accessTokenEnc: "",
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(orionConnections.firmId, firmId));
}

export async function listConnectedFirmIds(): Promise<string[]> {
  const rows = await db
    .select({ firmId: orionConnections.firmId })
    .from(orionConnections)
    .where(eq(orionConnections.status, "connected"));
  return rows.map((r) => r.firmId);
}

export async function createOauthState(input: {
  firmId: string;
  userId: string;
  state: string;
  codeVerifier: string;
  ttlMs: number;
}): Promise<void> {
  await db.insert(orionOauthStates).values({
    firmId: input.firmId,
    userId: input.userId,
    state: input.state,
    codeVerifier: input.codeVerifier,
    expiresAt: new Date(Date.now() + input.ttlMs),
  });
}

export async function consumeOauthState(
  state: string,
): Promise<{ firmId: string; userId: string; codeVerifier: string } | null> {
  const [row] = await db
    .delete(orionOauthStates)
    .where(and(eq(orionOauthStates.state, state), gt(orionOauthStates.expiresAt, new Date())))
    .returning();
  if (!row) {
    // Clean up an expired-but-present row so it can't linger.
    await db.delete(orionOauthStates).where(eq(orionOauthStates.state, state));
    return null;
  }
  return { firmId: row.firmId, userId: row.userId, codeVerifier: row.codeVerifier };
}
