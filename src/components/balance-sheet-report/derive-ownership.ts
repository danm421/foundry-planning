// src/components/balance-sheet-report/derive-ownership.ts
//
// The balance-sheet view-model still uses the pre-Phase-2 `owner` enum
// + `ownerEntityId` shape for ownership filtering. The projection-data API now
// emits `owners: AccountOwner[]` (junction-table model), so the legacy fields
// are absent. This helper bridges the two shapes by deriving
// `{ owner, ownerEntityId }` from `owners[]` + the household's `familyMembers`.

import type { AccountOwner } from "@/engine/ownership";
import type { FamilyMember } from "@/engine/types";

const EPS = 0.0001;

export interface LegacyOwnership {
  /** Household-role enum used by the balance-sheet ownership filter.
   *  `null` when the row is fully entity-owned or owned only by non-principal
   *  family members (children, etc.) — those rows shouldn't surface in the
   *  Client / Spouse / Joint personal views. */
  owner: "client" | "spouse" | "joint" | null;
  /** Single controlling entity id when 100% entity-owned, otherwise null. */
  ownerEntityId: string | null;
}

export function deriveLegacyOwnership(
  owners: AccountOwner[],
  familyMemberRoleById: Map<string, FamilyMember["role"]>,
): LegacyOwnership {
  if (owners.length === 0) {
    return { owner: null, ownerEntityId: null };
  }

  const entityOwners = owners.filter((o) => o.kind === "entity");
  const fmOwners = owners.filter((o) => o.kind === "family_member");

  // 100% single entity owner → entity-owned.
  if (
    entityOwners.length === 1 &&
    fmOwners.length === 0 &&
    Math.abs(entityOwners[0].percent - 1) < EPS
  ) {
    return {
      owner: null,
      ownerEntityId: (entityOwners[0] as { entityId: string }).entityId,
    };
  }

  // Multi-entity, or mixed family + entity → not representable in the legacy
  // enum. Personal views shouldn't show it; entities view shouldn't either
  // (the existing filter requires a single controlling entity).
  if (entityOwners.length > 0) {
    return { owner: null, ownerEntityId: null };
  }

  // Pure family-member ownership: collapse to client / spouse / joint based on
  // which household principals appear.
  const roles = new Set<FamilyMember["role"]>();
  for (const o of fmOwners) {
    const role = familyMemberRoleById.get(
      (o as { familyMemberId: string }).familyMemberId,
    );
    if (role) roles.add(role);
  }
  const hasClient = roles.has("client");
  const hasSpouse = roles.has("spouse");

  if (hasClient && hasSpouse) return { owner: "joint", ownerEntityId: null };
  if (hasClient) return { owner: "client", ownerEntityId: null };
  if (hasSpouse) return { owner: "spouse", ownerEntityId: null };

  // Only child / other family members own this row — exclude from personal
  // household views.
  return { owner: null, ownerEntityId: null };
}
