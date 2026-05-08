import type { AccountOwner } from "@/engine/ownership";
import type { ClientData, EntitySummary } from "@/engine/types";

export const BUSINESS_ENTITY_TYPES = new Set([
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "other",
]);

export function isBusinessEntity(e: EntitySummary | undefined): boolean {
  return !!e && !!e.entityType && BUSINESS_ENTITY_TYPES.has(e.entityType);
}

/** Fraction of a non-trust entity owned by household family members. Missing
 *  `owners` is treated as fully family-owned for back-compat with legacy data
 *  imported before the entity_owners table existed. */
export function familyOwnedFraction(entity: EntitySummary): number {
  if (entity.owners == null) return 1;
  const sum = entity.owners.reduce((s, o) => s + (o.percent ?? 0), 0);
  return Math.max(0, Math.min(1, sum));
}

export function entityById(
  tree: ClientData,
  id: string | undefined,
): EntitySummary | undefined {
  if (!id) return undefined;
  return tree.entities?.find((e) => e.id === id);
}

/** In-estate weight (0–1) for an account-level owner slice. */
export function inEstateWeight(tree: ClientData, owner: AccountOwner): number {
  if (owner.kind === "family_member") return 1;
  const entity = entityById(tree, owner.entityId);
  if (!entity) return 0;
  if (entity.entityType === "trust") return entity.isIrrevocable ? 0 : 1;
  if (isBusinessEntity(entity)) return familyOwnedFraction(entity);
  return 0;
}

/** Out-of-estate weight (0–1) for an account-level owner slice. */
export function outOfEstateWeight(
  tree: ClientData,
  owner: AccountOwner,
): number {
  if (owner.kind === "family_member") return 0;
  const entity = entityById(tree, owner.entityId);
  if (!entity) return 0;
  if (entity.entityType === "trust") return entity.isIrrevocable ? 1 : 0;
  if (isBusinessEntity(entity)) return 1 - familyOwnedFraction(entity);
  return 1;
}
