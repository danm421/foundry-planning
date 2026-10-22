// src/lib/integrations/connections.ts
import { and, asc, count, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationConnections,
  integrationHouseholdLinks,
  integrationOauthStates,
} from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import { getProvider } from "./registry";
import type { ProviderId, SyncingProviderId } from "./types";

type ConnectionStatus = "connected" | "disconnected" | "error";

export type IntegrationConnectionRow = {
  id: string;
  firmId: string;
  providerId: ProviderId;
  /** The advisor who owns it; null only for azure_openai (one per firm). */
  ownerUserId: string | null;
  name: string | null;
  status: ConnectionStatus;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenEnc: string;
  tokenExpiresAt: Date | null;
  scope: string | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  connectedAt: Date;
};

/** One of an advisor's own connections, as their settings list shows it. */
export type ConnectionSummary = {
  id: string;
  providerId: SyncingProviderId;
  name: string | null;
  status: ConnectionStatus;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  linkedHouseholds: number;
};

/** Decrypts a stored row into the shape every reader uses. */
export function toConnectionRow(
  row: typeof integrationConnections.$inferSelect,
): IntegrationConnectionRow {
  return {
    id: row.id,
    firmId: row.firmId,
    providerId: row.provider,
    ownerUserId: row.ownerUserId,
    name: row.name,
    status: row.status,
    // disconnect blanks accessTokenEnc to "", so there is nothing to decrypt.
    accessToken: row.accessTokenEnc ? decryptSecret(row.accessTokenEnc) : null,
    refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null,
    accessTokenEnc: row.accessTokenEnc,
    tokenExpiresAt: row.tokenExpiresAt,
    scope: row.scope,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
    connectedAt: row.connectedAt,
  };
}

function statusFields(
  status: ConnectionStatus,
  error?: string | null,
  extra?: { lastSyncedAt?: Date },
) {
  return {
    status,
    lastSyncError: error ?? null,
    updatedAt: new Date(),
    ...(extra?.lastSyncedAt ? { lastSyncedAt: extra.lastSyncedAt } : {}),
  };
}

/** Disconnect wipes the credentials but keeps the row (and its links) for a reconnect. */
function disconnectedFields() {
  return {
    status: "disconnected" as const,
    accessTokenEnc: "",
    refreshTokenEnc: null,
    tokenExpiresAt: null,
    updatedAt: new Date(),
  };
}

/** A new Addepar connection. An advisor may hold several, so this always inserts. */
export async function createByokConnection(input: {
  firmId: string;
  ownerUserId: string;
  name: string;
  secretBlob: string; // JSON {apiKey, apiSecret}
  configBlob: string; // JSON {apiBase, addeparFirmId}
}): Promise<string> {
  const [row] = await db
    .insert(integrationConnections)
    .values({
      firmId: input.firmId,
      provider: "addepar",
      ownerUserId: input.ownerUserId,
      name: input.name,
      accessTokenEnc: encryptSecret(input.secretBlob),
      scope: input.configBlob,
      status: "connected",
      connectedByUserId: input.ownerUserId,
    })
    .returning({ id: integrationConnections.id });
  return row.id;
}

/** Replaces an existing BYOK connection's key, config and name (a reconnect). The owner is untouched. */
export async function updateByokCredentials(input: {
  connectionId: string;
  name: string;
  secretBlob: string;
  configBlob: string;
  userId: string;
}): Promise<void> {
  await db
    .update(integrationConnections)
    .set({
      name: input.name,
      accessTokenEnc: encryptSecret(input.secretBlob),
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      scope: input.configBlob,
      connectedByUserId: input.userId,
      ...statusFields("connected"),
    })
    .where(eq(integrationConnections.id, input.connectionId));
}

/**
 * An advisor's OAuth connection: one per (firm, owner, provider), so a
 * reconnect updates the same row. Returns its id.
 */
export async function upsertOauthConnection(input: {
  firmId: string;
  providerId: "orion" | "schwab";
  ownerUserId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
}): Promise<string> {
  const values = {
    firmId: input.firmId,
    provider: input.providerId,
    ownerUserId: input.ownerUserId,
    accessTokenEnc: encryptSecret(input.accessToken),
    refreshTokenEnc: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    tokenExpiresAt: input.expiresAt ?? null,
    scope: input.scope ?? null,
    connectedByUserId: input.ownerUserId,
    ...statusFields("connected"),
  };
  const [row] = await db
    .insert(integrationConnections)
    .values(values)
    .onConflictDoUpdate({
      // Must match integration_conn_owner_oauth_uq's predicate for Postgres to infer it.
      target: [
        integrationConnections.firmId,
        integrationConnections.ownerUserId,
        integrationConnections.provider,
      ],
      targetWhere: sql`${integrationConnections.provider} IN ('orion','schwab')`,
      set: values,
    })
    .returning({ id: integrationConnections.id });
  return row.id;
}

/**
 * Persists a token refresh. Writes only the token fields and status, never
 * `owner_user_id` or `connected_by_user_id`: a refresh is not a reconnect.
 */
export async function storeRefreshedTokens(
  connectionId: string,
  t: { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scope: string | null },
): Promise<void> {
  await db
    .update(integrationConnections)
    .set({
      accessTokenEnc: encryptSecret(t.accessToken),
      refreshTokenEnc: t.refreshToken ? encryptSecret(t.refreshToken) : null,
      tokenExpiresAt: t.expiresAt,
      scope: t.scope,
      ...statusFields("connected"),
    })
    .where(eq(integrationConnections.id, connectionId));
}

/**
 * A connection by id, decrypted. System use only (sync, cron, token refresh):
 * it checks no ownership. A route that names a connection uses
 * `getOwnedConnection` instead.
 */
export async function loadConnection(connectionId: string): Promise<IntegrationConnectionRow | null> {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId))
    .limit(1);
  return row ? toConnectionRow(row) : null;
}

/** The caller's own syncing connections (never Azure), ordered by name, with their linked-household counts. */
export async function listOwnedConnections(input: {
  firmId: string;
  userId: string;
  providerId?: SyncingProviderId;
}): Promise<ConnectionSummary[]> {
  const c = integrationConnections;
  const rows = await db
    .select({
      id: c.id,
      provider: c.provider,
      name: c.name,
      status: c.status,
      lastSyncedAt: c.lastSyncedAt,
      lastSyncError: c.lastSyncError,
      linkedHouseholds: count(integrationHouseholdLinks.id),
    })
    .from(c)
    .leftJoin(integrationHouseholdLinks, eq(integrationHouseholdLinks.connectionId, c.id))
    .where(
      and(
        eq(c.firmId, input.firmId),
        eq(c.ownerUserId, input.userId),
        ne(c.provider, "azure_openai"),
        input.providerId ? eq(c.provider, input.providerId) : undefined,
      ),
    )
    .groupBy(c.id)
    .orderBy(asc(c.name), asc(c.connectedAt));
  return rows.map(({ provider, ...r }) => ({
    ...r,
    // Azure is filtered out above.
    providerId: provider as SyncingProviderId,
  }));
}

export async function setConnectionStatusById(
  connectionId: string,
  status: ConnectionStatus,
  error?: string | null,
  extra?: { lastSyncedAt?: Date },
): Promise<void> {
  await db
    .update(integrationConnections)
    .set(statusFields(status, error, extra))
    .where(eq(integrationConnections.id, connectionId));
}

export async function disconnectConnectionById(connectionId: string): Promise<void> {
  await db
    .update(integrationConnections)
    .set(disconnectedFields())
    .where(eq(integrationConnections.id, connectionId));
}

/**
 * Removes the connection; its household links cascade. Plan accounts are
 * untouched. Returns how many links went with it, for the audit row.
 */
export async function deleteConnectionById(connectionId: string): Promise<number> {
  const [{ links }] = await db
    .select({ links: count() })
    .from(integrationHouseholdLinks)
    .where(eq(integrationHouseholdLinks.connectionId, connectionId));
  await db.delete(integrationConnections).where(eq(integrationConnections.id, connectionId));
  return links;
}

/** Every connected syncing connection (never Azure) — the cron's work list. */
export async function listConnectedSyncingConnections(): Promise<
  Array<{ id: string; firmId: string; providerId: SyncingProviderId }>
> {
  const rows = await db
    .select({
      id: integrationConnections.id,
      firmId: integrationConnections.firmId,
      provider: integrationConnections.provider,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.status, "connected"),
        ne(integrationConnections.provider, "azure_openai"),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    firmId: r.firmId,
    // Azure is filtered out above.
    providerId: r.provider as SyncingProviderId,
  }));
}

/** Stores the firm's one Azure OpenAI BYOK connection (Addepar connections are
 * each advisor's own: `createByokConnection` / `updateByokCredentials`). The
 * encoded secret blob is encrypted into `accessTokenEnc`; the encoded config
 * blob is stored plaintext in `scope`. */
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
      // Azure OpenAI's one-per-firm index; must match its predicate for
      // Postgres to infer it. Any other provider never conflicts here.
      target: [integrationConnections.firmId, integrationConnections.provider],
      targetWhere: sql`${integrationConnections.provider} = 'azure_openai'`,
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
  return row ? toConnectionRow(row) : null;
}

export async function setConnectionStatus(
  firmId: string,
  providerId: ProviderId,
  status: ConnectionStatus,
  error?: string | null,
  extra?: { lastSyncedAt?: Date },
): Promise<void> {
  await db
    .update(integrationConnections)
    .set(statusFields(status, error, extra))
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
    .set(disconnectedFields())
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

/**
 * The firm's connected provider that actually pulls households, if any.
 *
 * Used by the client page to decide whether to offer "Link to Addepar" on a
 * client with no link yet — at that point there is no `link.provider` to read.
 * Filters exactly as the cron does: enabled kill-switch AND `syncs: true`, so a
 * credentials-only provider (azure_openai) never surfaces a link button.
 */
export async function getConnectedSyncingProviderId(
  firmId: string,
): Promise<ProviderId | null> {
  const rows = await db
    .select({ provider: integrationConnections.provider })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.firmId, firmId),
        eq(integrationConnections.status, "connected"),
      ),
    );
  for (const row of rows) {
    const def = getProvider(row.provider);
    if (def.isEnabled() && def.syncs) return row.provider;
  }
  return null;
}
