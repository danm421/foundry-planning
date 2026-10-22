// src/lib/integrations/households.ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, integrationHouseholdLinks } from "@/db/schema";
import { isUniqueViolation } from "@/lib/crm/household-relationships";
import type { ExtractedAccount } from "@/lib/extraction/types";
import { decodeAddeparConfig } from "./providers/addepar/credentials";
import type { ProviderId } from "./types";

/**
 * STOPGAP until Task 4 links through a chosen connection: the firm-level link
 * path below predates per-advisor connections, and it has at most one
 * connection per (firm, provider), so resolve that one. Throws when there is
 * none rather than inventing a connection.
 */
async function firmConnectionForLink(
  firmId: string,
  providerId: ProviderId,
): Promise<{ connectionId: string; externalFirmId: string | null }> {
  const [conn] = await db
    .select({ id: integrationConnections.id, scope: integrationConnections.scope })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.firmId, firmId),
        eq(integrationConnections.provider, providerId),
      ),
    )
    .limit(1);
  if (!conn) throw new Error(`No ${providerId} connection for this firm`);
  return {
    connectionId: conn.id,
    externalFirmId:
      providerId === "addepar" ? decodeAddeparConfig(conn.scope).addeparFirmId : null,
  };
}

export function getHouseholdLinks(firmId: string, providerId: ProviderId) {
  return db
    .select()
    .from(integrationHouseholdLinks)
    .where(
      and(
        eq(integrationHouseholdLinks.firmId, firmId),
        eq(integrationHouseholdLinks.provider, providerId),
      ),
    );
}

/** Every household linked through one connection — what a sync of it walks. */
export function getLinksForConnection(connectionId: string) {
  return db
    .select()
    .from(integrationHouseholdLinks)
    .where(eq(integrationHouseholdLinks.connectionId, connectionId));
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

export async function linkHousehold(input: {
  firmId: string;
  providerId: ProviderId;
  clientId: string;
  externalHouseholdId: string;
  userId: string;
}): Promise<void> {
  const connection = await firmConnectionForLink(input.firmId, input.providerId);
  await db
    .insert(integrationHouseholdLinks)
    .values({
      firmId: input.firmId,
      provider: input.providerId,
      ...connection,
      clientId: input.clientId,
      externalHouseholdId: input.externalHouseholdId,
      linkedByUserId: input.userId,
    })
    .onConflictDoUpdate({
      // Conflict target is client_id alone: re-linking a client REPLACES its
      // provider binding rather than adding a second one.
      target: integrationHouseholdLinks.clientId,
      set: {
        provider: input.providerId,
        ...connection,
        externalHouseholdId: input.externalHouseholdId,
        // firmId is deliberately NOT updated: org-scoping is immutable per
        // link row, matching the shipped Orion behavior. linkedByUserId DOES
        // update: the "Linked by" column must name whoever performed THIS
        // link, not whoever created the row originally.
        linkedByUserId: input.userId,
        // DB clock, not the app's: `updated_at` defaults to now() on insert, so
        // stamping the update from Node made the column go BACKWARDS whenever
        // Postgres ran ahead of this process (measured: 60ms on Neon).
        updatedAt: sql`now()`,
      },
    });
}

export async function getHouseholdLinkForClient(clientId: string) {
  const [row] = await db
    .select()
    .from(integrationHouseholdLinks)
    .where(eq(integrationHouseholdLinks.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export async function unlinkHousehold(firmId: string, clientId: string): Promise<void> {
  await db
    .delete(integrationHouseholdLinks)
    .where(
      and(
        eq(integrationHouseholdLinks.firmId, firmId),
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
 * render them identically — see the route's OPAQUE constant.
 */
export async function claimHousehold(input: {
  firmId: string;
  providerId: ProviderId;
  clientId: string;
  externalHouseholdId: string;
  userId: string;
  listHouseholds: () => Promise<Array<{ id: string; name: string }>>;
}): Promise<ClaimResult> {
  const households = await input.listHouseholds();
  const match = households.find((h) => h.id === input.externalHouseholdId);
  if (!match) return { ok: false, reason: "unknown_household" };

  const connection = await firmConnectionForLink(input.firmId, input.providerId);
  try {
    await db
      .insert(integrationHouseholdLinks)
      .values({
        firmId: input.firmId,
        provider: input.providerId,
        ...connection,
        clientId: input.clientId,
        externalHouseholdId: input.externalHouseholdId,
        linkedByUserId: input.userId,
      })
      .onConflictDoUpdate({
        // Same target as linkHousehold: re-claiming for a client REPLACES its
        // binding. A household already held by a DIFFERENT client trips the
        // (firm, provider, household) unique index instead, caught below.
        target: integrationHouseholdLinks.clientId,
        set: {
          provider: input.providerId,
          ...connection,
          externalHouseholdId: input.externalHouseholdId,
          // Re-sets linkedByUserId, same as linkHousehold: attribution is the
          // point of both paths (the audit trail must name who acted last),
          // so a re-claim re-attributes to the claiming advisor.
          linkedByUserId: input.userId,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "already_linked" };
    throw err;
  }

  return { ok: true, name: match.name };
}
