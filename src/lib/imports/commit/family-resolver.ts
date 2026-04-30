import { eq } from "drizzle-orm";

import { familyMembers } from "@/db/schema";

import type { Tx } from "./types";

export interface FamilyRoleIds {
  clientFmId: string | null;
  spouseFmId: string | null;
}

/**
 * Resolves the household's role='client' / role='spouse' familyMember rows
 * so caller modules can synthesize accountOwners / liabilityOwners rows from
 * the extraction's `owner: 'client'|'spouse'|'joint'` enum. Returns nulls
 * when the rows haven't been created yet — caller is expected to skip the
 * accountOwners insert in that case (mirrors the seeded "Household Cash"
 * account which is also created without owners).
 */
export async function loadFamilyRoleIds(
  tx: Tx,
  clientId: string,
): Promise<FamilyRoleIds> {
  const rows = await tx
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, clientId));
  return {
    clientFmId: rows.find((r) => r.role === "client")?.id ?? null,
    spouseFmId: rows.find((r) => r.role === "spouse")?.id ?? null,
  };
}
