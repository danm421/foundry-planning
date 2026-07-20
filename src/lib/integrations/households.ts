// src/lib/integrations/households.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationHouseholdLinks } from "@/db/schema";
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
