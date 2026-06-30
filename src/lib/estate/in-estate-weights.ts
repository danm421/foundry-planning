import type { AccountOwner } from "@/engine/ownership";
import type { ClientData, EntitySummary } from "@/engine/types";

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
 *  - Missing/unknown entity → 0
 *
 *  Post business-as-asset migration, trusts are the only entity kind that
 *  survives in `data.entities`. Businesses live in `data.accounts` and are
 *  handled by account-owner weighting instead. */
export function entityInEstateWeight(
  tree: ClientData,
  entityId: string,
): number {
  const entity = entityById(tree, entityId);
  if (!entity) return 0;
  if (entity.entityType === "trust") return entity.isIrrevocable ? 0 : 1;
  return 0;
}

/** In-estate weight (0–1) for an account-level owner slice. */
export function inEstateWeight(tree: ClientData, owner: AccountOwner): number {
  if (owner.kind === "family_member") return 1;
  // external_beneficiary owners represent death-benefit recipients, not present
  // ownership — they carry no current value into the gross estate.
  if (owner.kind === "external_beneficiary") return 0;
  // A completed gift to a person/charity we do not separately model — the slice
  // has left the client's gross estate.
  if (owner.kind === "gifted_away") return 0;
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
  if (owner.kind === "gifted_away") return 0;
  // Orphan-entity guard: missing entity returns 0 from BOTH inEstateWeight and
  // outOfEstateWeight (see in-estate-at-year.ts comment block) — without this
  // guard, the 1 - 0 here would assign the slice to out-of-estate, breaking
  // the documented orphan-drop behavior.
  const entity = entityById(tree, owner.entityId);
  if (!entity) return 0;
  return 1 - entityInEstateWeight(tree, owner.entityId);
}
