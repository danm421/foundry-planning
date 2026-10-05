import type { AccountOwner } from "@/engine/ownership";

/**
 * Household Cash is created with no `account_owners` rows (create-client.ts),
 * and nothing writes them later. Handed to the engine empty, `normalizeOwners`
 * backfills its legacy test-fixture CLIENT sentinel, which no death event
 * matches against a real family-member id, so the cash never enters either
 * estate and drops out of Total to Heirs.
 *
 * Fills in the ownership migration 0055 gave the Household Cash rows that
 * predate it: joint, client and spouse 50/50, or the client alone. Only the
 * household's top-level default checking is touched. Entity cash carries its
 * entity owner row, and a business's cash (`parentAccountId`) rides its business.
 */
export function fillHouseholdCashOwners(
  accounts: { id: string; isDefaultChecking: boolean; parentAccountId: string | null }[],
  ownersByAccountId: Map<string, AccountOwner[]>,
  familyMembers: { id: string; role: string }[],
): void {
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  if (!clientFm) return;
  const spouseFm = familyMembers.find((fm) => fm.role === "spouse");
  const owners: AccountOwner[] = spouseFm
    ? [
        { kind: "family_member", familyMemberId: clientFm.id, percent: 0.5 },
        { kind: "family_member", familyMemberId: spouseFm.id, percent: 0.5 },
      ]
    : [{ kind: "family_member", familyMemberId: clientFm.id, percent: 1 }];
  for (const a of accounts) {
    if (!a.isDefaultChecking || a.parentAccountId != null || ownersByAccountId.has(a.id)) continue;
    ownersByAccountId.set(a.id, owners);
  }
}
