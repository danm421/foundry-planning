import type { ClientData, Account } from "@/engine/types";
import { controllingFamilyMember, controllingEntity } from "@/engine/ownership";

/** A source-side grouping node for the estate flow chart. */
export interface OwnerBucket {
  /** "client" | "spouse" | "joint" | "community_property" | `entity:<id>` */
  id: string;
  kind: "client" | "spouse" | "joint" | "community_property" | "trust" | "business";
  label: string;
}

/**
 * Classify an account into the owner bucket it belongs to for the Sankey
 * source rail. A sole entity owner -> that entity's bucket; a sole client or
 * spouse owner -> that person; anything else (mixed family-member ownership)
 * -> the "joint" bucket. Joint accounts route 100% via survivorship at first
 * death, so they are a single bucket rather than fractional rows.
 */
export function classifyAccountOwner(
  data: ClientData,
  account: Account,
): OwnerBucket {
  const entityId = controllingEntity(account);
  if (entityId !== null) {
    const entity = (data.entities ?? []).find((e) => e.id === entityId);
    return {
      id: `entity:${entityId}`,
      kind: entity?.entityType === "trust" ? "trust" : "business",
      label: entity?.name ?? "Unknown entity",
    };
  }

  const fmId = controllingFamilyMember(account);
  const familyMembers = data.familyMembers ?? [];
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const spouseFm = familyMembers.find((fm) => fm.role === "spouse");

  if (fmId !== null && fmId === clientFm?.id) {
    return { id: "client", kind: "client", label: clientFm.firstName ?? "Client" };
  }
  if (fmId !== null && fmId === spouseFm?.id) {
    return { id: "spouse", kind: "spouse", label: spouseFm.firstName ?? "Spouse" };
  }
  // The remaining case is a mixed family-member account (typically a joint
  // household 50/50 split). Differentiate JTWROS from community property by
  // the account's titlingType — survivorship behavior at first death is the
  // same, but the source-rail label differs.
  if (account.titlingType === "community_property") {
    return { id: "community_property", kind: "community_property", label: "Community Property" };
  }
  return { id: "joint", kind: "joint", label: "Joint" };
}
