// src/lib/integrations/households.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationHouseholdLinks } from "@/db/schema";
import { isUniqueViolation } from "@/lib/crm/household-relationships";
import type { ProviderId } from "./types";

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

export async function linkHousehold(input: {
  firmId: string;
  providerId: ProviderId;
  clientId: string;
  externalHouseholdId: string;
  userId: string;
}): Promise<void> {
  await db
    .insert(integrationHouseholdLinks)
    .values({
      firmId: input.firmId,
      provider: input.providerId,
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
        externalHouseholdId: input.externalHouseholdId,
        // firmId is deliberately NOT updated: org-scoping is immutable per
        // link row, matching the shipped Orion behavior.
        updatedAt: new Date(),
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

  try {
    await db
      .insert(integrationHouseholdLinks)
      .values({
        firmId: input.firmId,
        provider: input.providerId,
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
          externalHouseholdId: input.externalHouseholdId,
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
