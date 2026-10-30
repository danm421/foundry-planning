// src/lib/workspace/connections.ts
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { workspaceConnections } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { AccountSummary, ProviderTokenSet, WorkspaceProvider } from "./types";
import { MAX_ACCOUNTS_PER_ADVISOR } from "./accounts";

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
  connectedAt: Date;
};

/** What a fresh token set writes: the tokens, encrypted, and a connection that works again. */
function tokenColumns(tokens: ProviderTokenSet) {
  return {
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    tokenExpiresAt: new Date(Date.now() + tokens.expiresInSec * 1000),
    scope: tokens.scope,
    status: "connected" as const,
    lastError: null,
  };
}

type ConnectionRow = typeof workspaceConnections.$inferSelect;

function toConnection(row: ConnectionRow): WorkspaceConnection {
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
    connectedAt: row.connectedAt,
  };
}

const summaryColumns = {
  id: workspaceConnections.id,
  provider: workspaceConnections.provider,
  email: workspaceConnections.externalEmail,
  status: workspaceConnections.status,
  connectedAt: workspaceConnections.connectedAt,
};

function toSummary(r: { id: string; provider: WorkspaceProvider; email: string; status: "connected" | "needs_reconnect"; connectedAt: Date }): AccountSummary {
  return { ...r, connectedAt: r.connectedAt.toISOString() };
}

/**
 * A user may hold up to MAX_ACCOUNTS_PER_ADVISOR accounts; each external
 * account belongs to one user per firm. Reconnecting the user's own account
 * refreshes the row in place (`connectedAt` is never touched).
 */
export async function upsertUserConnection(input: {
  firmId: string;
  userId: string;
  provider: WorkspaceProvider;
  tenantId: string;
  externalUserId: string;
  externalEmail: string;
  tokens: ProviderTokenSet;
}): Promise<{ ok: true; id: string } | { ok: false; reason: "account_in_use" | "too_many_accounts" }> {
  const fields = {
    tenantId: input.tenantId,
    externalEmail: input.externalEmail,
    ...tokenColumns(input.tokens),
  };
  return db.transaction(async (tx) => {
    // Serializes this advisor's connects so two at once can't both pass the count.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`workspace:${input.firmId}:${input.userId}`}))`);
    const [existing] = await tx
      .select({ id: workspaceConnections.id })
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.firmId, input.firmId),
          eq(workspaceConnections.provider, input.provider),
          eq(workspaceConnections.externalUserId, input.externalUserId),
        ),
      );
    if (!existing) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(workspaceConnections)
        .where(and(eq(workspaceConnections.firmId, input.firmId), eq(workspaceConnections.userId, input.userId)));
      if (n >= MAX_ACCOUNTS_PER_ADVISOR) return { ok: false as const, reason: "too_many_accounts" as const };
    }
    const [row] = await tx
      .insert(workspaceConnections)
      .values({
        firmId: input.firmId,
        userId: input.userId,
        provider: input.provider,
        externalUserId: input.externalUserId,
        ...fields,
      })
      .onConflictDoUpdate({
        target: [workspaceConnections.firmId, workspaceConnections.provider, workspaceConnections.externalUserId],
        set: { ...fields, updatedAt: new Date() },
        setWhere: eq(workspaceConnections.userId, input.userId),
      })
      .returning({ id: workspaceConnections.id });
    return row ? { ok: true as const, id: row.id } : { ok: false as const, reason: "account_in_use" as const };
  });
}

export async function getConnectionById(connectionId: string): Promise<WorkspaceConnection | null> {
  const [row] = await db.select().from(workspaceConnections).where(eq(workspaceConnections.id, connectionId));
  return row ? toConnection(row) : null;
}

/** Oldest first. */
export async function listUserConnections(firmId: string, userId: string): Promise<WorkspaceConnection[]> {
  const rows = await db
    .select()
    .from(workspaceConnections)
    .where(and(eq(workspaceConnections.firmId, firmId), eq(workspaceConnections.userId, userId)))
    .orderBy(asc(workspaceConnections.connectedAt));
  return rows.map(toConnection);
}

/** Selects no token columns. */
export async function listUserConnectionSummaries(firmId: string, userId: string): Promise<AccountSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(workspaceConnections)
    .where(and(eq(workspaceConnections.firmId, firmId), eq(workspaceConnections.userId, userId)))
    .orderBy(asc(workspaceConnections.connectedAt));
  return rows.map(toSummary);
}

/** Every provider, every advisor in the firm. Selects no token columns. */
export async function listFirmConnections(firmId: string): Promise<Array<AccountSummary & { userId: string }>> {
  const rows = await db
    .select({ ...summaryColumns, userId: workspaceConnections.userId })
    .from(workspaceConnections)
    .where(eq(workspaceConnections.firmId, firmId))
    .orderBy(asc(workspaceConnections.connectedAt));
  return rows.map((r) => ({ ...toSummary(r), userId: r.userId }));
}

/** True when a row went; `opts.userId` (whenever given, even "") restricts the delete to that owner. */
export async function deleteConnection(firmId: string, connectionId: string, opts?: { userId?: string }): Promise<boolean> {
  const deleted = await db
    .delete(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.firmId, firmId),
        eq(workspaceConnections.id, connectionId),
        opts?.userId !== undefined ? eq(workspaceConnections.userId, opts.userId) : undefined,
      ),
    )
    .returning({ id: workspaceConnections.id });
  return deleted.length > 0;
}

/** For a person leaving the firm: every connected address, every provider. */
export async function removeWorkspaceMember(firmId: string, userId: string): Promise<void> {
  await db
    .delete(workspaceConnections)
    .where(and(eq(workspaceConnections.firmId, firmId), eq(workspaceConnections.userId, userId)));
}

export async function storeRefreshedTokens(connectionId: string, tokens: ProviderTokenSet): Promise<void> {
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
