// src/lib/orion/households.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orionHouseholdLinks } from "@/db/schema";

export function getHouseholdLinks(firmId: string) {
  return db.select().from(orionHouseholdLinks).where(eq(orionHouseholdLinks.firmId, firmId));
}

export async function linkHousehold(input: {
  firmId: string;
  clientId: string;
  orionHouseholdId: string;
  userId: string;
}): Promise<void> {
  await db
    .insert(orionHouseholdLinks)
    .values({
      firmId: input.firmId,
      clientId: input.clientId,
      orionHouseholdId: input.orionHouseholdId,
      linkedByUserId: input.userId,
    })
    .onConflictDoUpdate({
      target: orionHouseholdLinks.clientId,
      set: { orionHouseholdId: input.orionHouseholdId, updatedAt: new Date() },
    });
}

export async function getHouseholdLinkForClient(clientId: string) {
  const [row] = await db
    .select()
    .from(orionHouseholdLinks)
    .where(eq(orionHouseholdLinks.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export async function unlinkHousehold(firmId: string, clientId: string): Promise<void> {
  await db
    .delete(orionHouseholdLinks)
    .where(and(eq(orionHouseholdLinks.firmId, firmId), eq(orionHouseholdLinks.clientId, clientId)));
}
