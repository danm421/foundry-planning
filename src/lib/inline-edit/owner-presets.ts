// src/lib/inline-edit/owner-presets.ts
//
// AccountOwner[] <-> select-value, for the inline owner cell.
//
// The cell can only honestly express ownership it can round-trip. Anything
// else — a real percentage split, a gifted-away or external-beneficiary
// holder, a business sub-asset — returns null here and the cell renders a
// read-only label instead. Offering a preset for those would replace the split
// on the next pick, silently.
//
// JOINT AND COMMUNITY PROPERTY PRODUCE THE IDENTICAL owners ARRAY. They differ
// ONLY by `titlingType`, which drives §1014(b)(6) full step-up vs §2040(b)
// 50/50. That is why every function here returns/accepts the pair, never
// `owners` alone: writing owners without titlingType flips the basis treatment
// of a community-property account with nothing visible on the row.
import { deriveMode } from "@/components/forms/ownership-editor";
import type { AccountOwner } from "@/engine/ownership";

export type OwnerTitling = "jtwros" | "community_property";

export interface OwnerSelection {
  owners: AccountOwner[];
  titlingType: OwnerTitling;
}

/** Must stay aligned with `ownership-editor.tsx` and the API at
 *  `src/lib/ownership.ts`, both of which use 0.0001. */
const EPSILON = 0.0001;

/**
 * The `<select>` value for this ownership, or null when it isn't a preset the
 * cell can round-trip (caller renders a read-only label).
 */
export function ownerSelectValue(
  owners: AccountOwner[],
  clientId: string | undefined,
  spouseId: string | undefined,
  titlingType: OwnerTitling,
): string | null {
  // `deriveMode` owns the canonical four. Reused rather than reimplemented so
  // the inline cell and the full ownership editor cannot disagree about what
  // "Joint" means.
  const mode = deriveMode(owners, clientId, spouseId, titlingType);
  if (mode !== "custom") return mode;

  // `deriveMode` calls everything else "custom", but a single 100% holder is
  // still something we can round-trip — an entity-owned account, or a child's
  // UTMA. Only these two kinds: `gifted_away` and `external_beneficiary` are
  // estate-planning states, not ownership the advisor should retitle from a
  // one-click dropdown.
  if (owners.length === 1 && Math.abs(owners[0].percent - 1) < EPSILON) {
    const o = owners[0];
    if (o.kind === "entity") return `ent:${o.entityId}`;
    if (o.kind === "family_member") return `fm:${o.familyMemberId}`;
  }
  return null;
}

/**
 * The ownership a picked `<select>` value means, or null when it can't be
 * built (e.g. "joint" on a household with no spouse).
 *
 * Joint order is client-then-spouse because `deriveMode` reads `value[0]` as
 * the client and `value[1]` as the spouse; reversing it would make every
 * freshly-set joint account read back as "custom".
 */
export function ownersFromSelectValue(
  v: string,
  clientId: string | undefined,
  spouseId: string | undefined,
): OwnerSelection | null {
  if (v === "client") {
    return clientId
      ? { owners: [{ kind: "family_member", familyMemberId: clientId, percent: 1 }], titlingType: "jtwros" }
      : null;
  }
  if (v === "spouse") {
    return spouseId
      ? { owners: [{ kind: "family_member", familyMemberId: spouseId, percent: 1 }], titlingType: "jtwros" }
      : null;
  }
  if (v === "joint" || v === "community_property") {
    if (!clientId || !spouseId) return null;
    return {
      owners: [
        { kind: "family_member", familyMemberId: clientId, percent: 0.5 },
        { kind: "family_member", familyMemberId: spouseId, percent: 0.5 },
      ],
      titlingType: v === "community_property" ? "community_property" : "jtwros",
    };
  }
  if (v.startsWith("ent:")) {
    return { owners: [{ kind: "entity", entityId: v.slice(4), percent: 1 }], titlingType: "jtwros" };
  }
  if (v.startsWith("fm:")) {
    return { owners: [{ kind: "family_member", familyMemberId: v.slice(3), percent: 1 }], titlingType: "jtwros" };
  }
  return null;
}
