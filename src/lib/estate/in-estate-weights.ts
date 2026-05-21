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

/** Fraction of a non-trust entity owned (directly) by family members. Retained
 *  for callers that need the literal direct family share — NOT the in-estate
 *  weight, which now requires the recursive `entityInEstateWeight`. Missing
 *  `owners` is treated as fully family-owned for back-compat with legacy data
 *  imported before the entity_owners table existed. */
export function familyOwnedFraction(entity: EntitySummary): number {
  if (entity.owners == null) return 1;
  const sum = entity.owners
    .filter((o) => o.kind === "family_member")
    .reduce((s, o) => s + (o.percent ?? 0), 0);
  return Math.max(0, Math.min(1, sum));
}

export function entityById(
  tree: ClientData,
  id: string | undefined,
): EntitySummary | undefined {
  if (!id) return undefined;
  return tree.entities?.find((e) => e.id === id);
}

/** In-estate weight (0–1) for an entity considered as a whole.
 *  - Revocable trust → 1
 *  - Irrevocable trust → 0
 *  - Business → recursive walk over its owners (family contributes 1×%,
 *    entity-owners contribute recursively by their own in-estate weight).
 *  - Missing/unknown entity → 0
 *  Cycles bail to 0 (guard against malformed data). */
export function entityInEstateWeight(
  tree: ClientData,
  entityId: string,
  seen?: ReadonlySet<string>,
): number {
  if (seen?.has(entityId)) return 0;
  const entity = entityById(tree, entityId);
  if (!entity) return 0;
  if (entity.entityType === "trust") return entity.isIrrevocable ? 0 : 1;
  if (!isBusinessEntity(entity)) return 0;
  const owners = entity.owners;
  // Legacy back-compat: missing owners ⇒ fully family-owned. An explicit empty
  // owners array means "we know there are no household owners" → 0.
  if (owners == null) return 1;
  if (owners.length === 0) return 0;
  const next = new Set(seen ?? []);
  next.add(entityId);
  return owners.reduce((sum, o) => {
    if (o.kind === "family_member") return sum + (o.percent ?? 0);
    return sum + (o.percent ?? 0) * entityInEstateWeight(tree, o.entityId, next);
  }, 0);
}

/** In-estate weight (0–1) for an account-level owner slice. */
export function inEstateWeight(tree: ClientData, owner: AccountOwner): number {
  if (owner.kind === "family_member") return 1;
  // external_beneficiary owners represent death-benefit recipients, not present
  // ownership — they carry no current value into the gross estate.
  if (owner.kind === "external_beneficiary") return 0;
  return entityInEstateWeight(tree, owner.entityId);
}

/** Out-of-estate weight (0–1) for an account-level owner slice. */
export function outOfEstateWeight(
  tree: ClientData,
  owner: AccountOwner,
): number {
  if (owner.kind === "family_member") return 0;
  // external_beneficiary owners carry no current value — neither in nor out
  // of the household estate.
  if (owner.kind === "external_beneficiary") return 0;
  const entity = entityById(tree, owner.entityId);
  if (!entity) return 0;
  return 1 - entityInEstateWeight(tree, owner.entityId);
}
