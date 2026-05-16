import type { ClientData, Account } from "@/engine/types";
import { controllingFamilyMember, controllingEntity } from "@/engine/ownership";

/** A source-side grouping node for the estate flow chart. */
export interface OwnerBucket {
  /** "client" | "spouse" | "joint" | `entity:<id>` */
  id: string;
  kind: "client" | "spouse" | "joint" | "trust" | "business";
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
  return { id: "joint", kind: "joint", label: "Joint" };
}
