// src/lib/workspace/connections.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceConnections } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { MicrosoftTokenSet, WorkspaceProvider } from "./types";

export type WorkspaceConnection = {
  id: string;
  firmId: string;
  userId: string;
  provider: WorkspaceProvider;
  tenantId: string;
  externalUserId: string;
  externalEmail: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
  status: "connected" | "needs_reconnect";
  lastError: string | null;
};

/** What a fresh token set writes: the tokens, encrypted, and a connection that works again. */
function tokenColumns(tokens: MicrosoftTokenSet) {
  return {
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    tokenExpiresAt: new Date(Date.now() + tokens.expiresInSec * 1000),
    scope: tokens.scope,
    status: "connected" as const,
    lastError: null,
  };
}

/** Drizzle wraps driver errors; the Postgres code/constraint can sit on `.cause`. */
function isAccountInUse(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } };
  const code = e.code ?? e.cause?.code;
  const constraint = e.constraint ?? e.cause?.constraint;
  return code === "23505" && constraint === "ws_conn_account_uq";
}

export async function getUserConnection(
  firmId: string,
  userId: string,
  provider: WorkspaceProvider,
): Promise<WorkspaceConnection | null> {
  const [row] = await db
    .select()
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.firmId, firmId),
        eq(workspaceConnections.userId, userId),
        eq(workspaceConnections.provider, provider),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    firmId: row.firmId,
    userId: row.userId,
    provider: row.provider,
    tenantId: row.tenantId,
    externalUserId: row.externalUserId,
    externalEmail: row.externalEmail,
    accessToken: decryptSecret(row.accessTokenEnc),
    refreshToken: decryptSecret(row.refreshTokenEnc),
    tokenExpiresAt: row.tokenExpiresAt,
    scope: row.scope,
    status: row.status,
    lastError: row.lastError,
  };
}

/** Selects no token columns. */
export async function listFirmConnectionSummaries(
  firmId: string,
  provider: WorkspaceProvider,
): Promise<Array<{ userId: string; externalEmail: string; status: "connected" | "needs_reconnect" }>> {
  return db
    .select({
      userId: workspaceConnections.userId,
      externalEmail: workspaceConnections.externalEmail,
      status: workspaceConnections.status,
    })
    .from(workspaceConnections)
    .where(and(eq(workspaceConnections.firmId, firmId), eq(workspaceConnections.provider, provider)));
}

export async function upsertUserConnection(input: {
  firmId: string;
  userId: string;
  provider: WorkspaceProvider;
  tenantId: string;
  externalUserId: string;
  externalEmail: string;
  tokens: MicrosoftTokenSet;
}): Promise<{ ok: true; id: string } | { ok: false; reason: "account_in_use" }> {
  const fields = {
    tenantId: input.tenantId,
    externalUserId: input.externalUserId,
    externalEmail: input.externalEmail,
    ...tokenColumns(input.tokens),
  };
  try {
    const [row] = await db
      .insert(workspaceConnections)
      .values({ firmId: input.firmId, userId: input.userId, provider: input.provider, ...fields })
      .onConflictDoUpdate({
        target: [workspaceConnections.firmId, workspaceConnections.userId, workspaceConnections.provider],
        set: { ...fields, connectedAt: new Date(), updatedAt: new Date() },
      })
      .returning({ id: workspaceConnections.id });
    return { ok: true, id: row.id };
  } catch (err) {
    if (isAccountInUse(err)) return { ok: false, reason: "account_in_use" };
    throw err;
  }
}

export async function storeRefreshedTokens(connectionId: string, tokens: MicrosoftTokenSet): Promise<void> {
  await db
    .update(workspaceConnections)
    .set({ ...tokenColumns(tokens), updatedAt: new Date() })
    .where(eq(workspaceConnections.id, connectionId));
}

/** `reason` is a short code (e.g. `invalid_grant`), never a response body. */
export async function markNeedsReconnect(connectionId: string, reason: string): Promise<void> {
  await db
    .update(workspaceConnections)
    .set({ status: "needs_reconnect", lastError: reason, updatedAt: new Date() })
    .where(eq(workspaceConnections.id, connectionId));
}
