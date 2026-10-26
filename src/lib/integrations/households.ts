// src/lib/integrations/households.ts
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, integrationHouseholdLinks } from "@/db/schema";
import { isUniqueViolation } from "@/lib/crm/household-relationships";
import type { ExtractedAccount } from "@/lib/extraction/types";
import type { IntegrationConnectionRow } from "./connections";
import { decodeAddeparConfig } from "./providers/addepar/credentials";
import type { ProviderId } from "./types";

/** The parts of a connection a link is made from. */
type LinkConnection = Pick<IntegrationConnectionRow, "id" | "firmId" | "providerId" | "scope">;

export type LinkOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "client_linked_elsewhere" | "household_linked_elsewhere";
      linkedByUserId: string | null;
    };

/** The Addepar firm a connection reaches, which scopes its group ids; null for Orion and Schwab. */
export function externalFirmIdOf(
  connection: Pick<IntegrationConnectionRow, "providerId" | "scope">,
): string | null {
  return connection.providerId === "addepar"
    ? decodeAddeparConfig(connection.scope).addeparFirmId
    : null;
}

/** Every household linked through one connection — what a sync of it walks. */
export function getLinksForConnection(connectionId: string) {
  return db
    .select()
    .from(integrationHouseholdLinks)
    .where(eq(integrationHouseholdLinks.connectionId, connectionId));
}

/**
 * The firm's links held through any connection but this one, of every
 * provider: what the household table needs to show which clients and
 * households a colleague already holds. A client has one link whatever its
 * provider, so the caller narrows by provider only for households. Each row
 * carries its client's advisor and Private flag, so the caller can leave out
 * clients it may not see.
 */
export function listFirmLinksOutside(i: { firmId: string; connectionId: string }): Promise<
  Array<{
    clientId: string;
    advisorId: string;
    isPrivate: boolean;
    providerId: ProviderId;
    externalFirmId: string | null;
    externalHouseholdId: string;
    linkedByUserId: string | null;
  }>
> {
  const l = integrationHouseholdLinks;
  return db
    .select({
      clientId: l.clientId,
      advisorId: clients.advisorId,
      isPrivate: clients.isPrivate,
      providerId: l.provider,
      externalFirmId: l.externalFirmId,
      externalHouseholdId: l.externalHouseholdId,
      linkedByUserId: l.linkedByUserId,
    })
    .from(l)
    .innerJoin(clients, eq(clients.id, l.clientId))
    .where(and(eq(l.firmId, i.firmId), ne(l.connectionId, i.connectionId)));
}

/**
 * Stores a household's accounts from a pull (the mapped import rows) on its
 * link, so the household table can count them and the account panel can work
 * from them without calling the provider again.
 */
export async function recordLastPull(
  linkId: string,
  accounts: ExtractedAccount[],
  pulledAt: Date,
): Promise<void> {
  await db
    .update(integrationHouseholdLinks)
    .set({ lastPullAccounts: accounts, lastPulledAt: pulledAt })
    .where(eq(integrationHouseholdLinks.id, linkId));
}

/**
 * Links a client to an external household through one connection. A client
 * has one link, so re-linking it on the SAME connection replaces its
 * household. A link held through any other connection is never replaced: the
 * caller gets a refusal naming who holds it. The same goes for a household
 * already feeding another client in the firm (the household unique index).
 */
export async function linkHouseholdOnConnection(i: {
  connection: LinkConnection;
  clientId: string;
  externalHouseholdId: string;
  userId: string;
}): Promise<LinkOutcome> {
  const { connection } = i;
  const externalFirmId = externalFirmIdOf(connection);
  let written: Array<{ id: string }>;
  try {
    written = await db
      .insert(integrationHouseholdLinks)
      .values({
        firmId: connection.firmId,
        provider: connection.providerId,
        connectionId: connection.id,
        clientId: i.clientId,
        externalHouseholdId: i.externalHouseholdId,
        externalFirmId,
        linkedByUserId: i.userId,
      })
      .onConflictDoUpdate({
        // One link per client. firmId, provider and connectionId are never
        // updated: the guard below only lets the update through on the link's
        // own connection, so a colleague's link stays exactly as it was.
        target: integrationHouseholdLinks.clientId,
        set: {
          externalHouseholdId: i.externalHouseholdId,
          externalFirmId,
          // "Linked by" names whoever performed THIS link.
          linkedByUserId: i.userId,
          // The last pull belongs to the household it came from: a different
          // household starts clean, the same one keeps its snapshot.
          lastPullAccounts: sql`CASE WHEN ${integrationHouseholdLinks.externalHouseholdId} = excluded.external_household_id THEN ${integrationHouseholdLinks.lastPullAccounts} ELSE NULL END`,
          lastPulledAt: sql`CASE WHEN ${integrationHouseholdLinks.externalHouseholdId} = excluded.external_household_id THEN ${integrationHouseholdLinks.lastPulledAt} ELSE NULL END`,
          // DB clock, not the app's: `updated_at` defaults to now() on insert,
          // so stamping the update from Node made the column go BACKWARDS
          // whenever Postgres ran ahead of this process (measured: 60ms on Neon).
          updatedAt: sql`now()`,
        },
        setWhere: eq(integrationHouseholdLinks.connectionId, connection.id),
      })
      .returning({ id: integrationHouseholdLinks.id });
  } catch (err) {
    // client_id is the conflict target, so the only unique index left to trip
    // is the household one: another client already has this household.
    if (!isUniqueViolation(err)) throw err;
    const [holder] = await db
      .select({ linkedByUserId: integrationHouseholdLinks.linkedByUserId })
      .from(integrationHouseholdLinks)
      .where(
        and(
          eq(integrationHouseholdLinks.firmId, connection.firmId),
          eq(integrationHouseholdLinks.provider, connection.providerId),
          sql`coalesce(${integrationHouseholdLinks.externalFirmId}, '') = ${externalFirmId ?? ""}`,
          eq(integrationHouseholdLinks.externalHouseholdId, i.externalHouseholdId),
        ),
      )
      .limit(1);
    return {
      ok: false,
      reason: "household_linked_elsewhere",
      linkedByUserId: holder?.linkedByUserId ?? null,
    };
  }
  if (written.length > 0) return { ok: true };

  // The guarded update wrote nothing: the client is linked through another connection.
  const holder = await getHouseholdLinkForClient(i.clientId);
  return { ok: false, reason: "client_linked_elsewhere", linkedByUserId: holder?.linkedByUserId ?? null };
}

export async function getHouseholdLinkForClient(clientId: string) {
  const [row] = await db
    .select()
    .from(integrationHouseholdLinks)
    .where(eq(integrationHouseholdLinks.clientId, clientId))
    .limit(1);
  return row ?? null;
}

/** Removes a client's link, only when it's held through this connection. */
export async function unlinkHousehold(connectionId: string, clientId: string): Promise<void> {
  await db
    .delete(integrationHouseholdLinks)
    .where(
      and(
        eq(integrationHouseholdLinks.connectionId, connectionId),
        eq(integrationHouseholdLinks.clientId, clientId),
      ),
    );
}

export type ClaimResult =
  | { ok: true; name: string }
  | { ok: false; reason: "unknown_household" | "already_linked" };

/**
 * Claim an external household for a client by its id — the advisor-facing path,
 * where no browsable list exists.
 *
 * `listHouseholds` is injected rather than imported so this stays free of the
 * provider registry and testable without a live connection. The full list is
 * fetched and matched SERVER-SIDE; it must never cross a response boundary, or
 * the claim endpoint becomes the enumeration tool it exists to replace.
 *
 * Both failure reasons are returned rather than thrown because the caller must
 * render them identically — see the route's OPAQUE constant. That's why every
 * refusal from `linkHouseholdOnConnection` (a household another client holds,
 * or a client linked through another connection) becomes `already_linked`.
 */
export async function claimHousehold(input: {
  connection: LinkConnection;
  clientId: string;
  externalHouseholdId: string;
  userId: string;
  listHouseholds: () => Promise<Array<{ id: string; name: string }>>;
}): Promise<ClaimResult> {
  const households = await input.listHouseholds();
  const match = households.find((h) => h.id === input.externalHouseholdId);
  if (!match) return { ok: false, reason: "unknown_household" };

  const outcome = await linkHouseholdOnConnection({
    connection: input.connection,
    clientId: input.clientId,
    externalHouseholdId: input.externalHouseholdId,
    userId: input.userId,
  });
  if (!outcome.ok) return { ok: false, reason: "already_linked" };
  return { ok: true, name: match.name };
}
