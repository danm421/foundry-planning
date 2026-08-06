import { eq } from "drizzle-orm";

import { accountOwners, familyMembers, liabilityOwners } from "@/db/schema";

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

/**
 * Turn a coarse `client | spouse | joint` owner into account_owners rows:
 * joint splits 50/50 across both spouses, spouse/client take 100%. Shared by
 * every writer that only has the coarse enum — the AI-import commit and the
 * intake apply — so the rule (and the retirement carve-out) is stated once.
 *
 * Retirement accounts can't be jointly held, so a "joint" retirement account
 * collapses to a single owner. Callers pass `isRetirement` themselves because
 * they identify retirement differently (the import resolves a sub_type; intake
 * only has the form's category).
 *
 * Writes nothing when the family_members row it would point at doesn't exist —
 * the account stays ownerless rather than blocking the commit.
 */
export async function synthesizeAccountOwners(
  tx: Tx,
  accountId: string,
  owner: "client" | "spouse" | "joint" | undefined,
  { clientFmId, spouseFmId }: FamilyRoleIds,
  isRetirement: boolean,
): Promise<void> {
  if (!isRetirement && owner === "joint" && clientFmId && spouseFmId) {
    await tx.insert(accountOwners).values([
      { accountId, familyMemberId: clientFmId, entityId: null, percent: "0.5000" },
      { accountId, familyMemberId: spouseFmId, entityId: null, percent: "0.5000" },
    ]);
    return;
  }

  if (owner === "spouse" && spouseFmId) {
    await tx.insert(accountOwners).values({
      accountId,
      familyMemberId: spouseFmId,
      entityId: null,
      percent: "1.0000",
    });
    return;
  }

  // Default: client at 100% — covers explicit "client", a joint/spouse account
  // on a household with no spouse row, and an owner the caller never supplied.
  if (clientFmId) {
    await tx.insert(accountOwners).values({
      accountId,
      familyMemberId: clientFmId,
      entityId: null,
      percent: "1.0000",
    });
  }
}

/**
 * The liability_owners twin of synthesizeAccountOwners: same coarse
 * client | spouse | joint enum, same 50/50 joint split, same "write nothing
 * rather than block the commit" fallback. Kept beside its account sibling so
 * the ownership rule is stated once even though the two satellite tables key
 * on different columns.
 *
 * A liability left ownerless is not harmless — downstream balance-sheet and
 * portal debt readouts attribute by owner and drop what nobody owns — so every
 * writer that has the enum should call this.
 *
 * There is no retirement carve-out here: unlike a retirement account, nothing
 * stops a debt from being jointly held.
 */
export async function synthesizeLiabilityOwners(
  tx: Tx,
  liabilityId: string,
  owner: "client" | "spouse" | "joint" | undefined,
  { clientFmId, spouseFmId }: FamilyRoleIds,
): Promise<void> {
  if (owner === "joint" && clientFmId && spouseFmId) {
    await tx.insert(liabilityOwners).values([
      { liabilityId, familyMemberId: clientFmId, entityId: null, percent: "0.5000" },
      { liabilityId, familyMemberId: spouseFmId, entityId: null, percent: "0.5000" },
    ]);
    return;
  }

  if (owner === "spouse" && spouseFmId) {
    await tx.insert(liabilityOwners).values({
      liabilityId,
      familyMemberId: spouseFmId,
      entityId: null,
      percent: "1.0000",
    });
    return;
  }

  if (clientFmId) {
    await tx.insert(liabilityOwners).values({
      liabilityId,
      familyMemberId: clientFmId,
      entityId: null,
      percent: "1.0000",
    });
  }
}
