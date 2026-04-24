export type Individual = "client" | "spouse" | "joint";

export type ResolvedOwner =
  | { kind: "entity"; id: string }
  | { kind: "family_member"; id: string }
  | { kind: "individual"; who: Individual };

export function resolveAccountOwner(a: {
  owner: Individual;
  ownerEntityId: string | null;
  ownerFamilyMemberId: string | null;
}): ResolvedOwner {
  if (a.ownerEntityId) return { kind: "entity", id: a.ownerEntityId };
  if (a.ownerFamilyMemberId)
    return { kind: "family_member", id: a.ownerFamilyMemberId };
  return { kind: "individual", who: a.owner };
}
