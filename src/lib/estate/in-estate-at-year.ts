/**
 * Year-aware fractional sums of in-estate vs. out-of-estate value.
 *
 * "In-estate" = family-member-owned slices + revocable-trust-owned slices
 *               + family-owned business-entity slices (LLC / S-Corp / etc.)
 *               + flat business-entity valuations weighted by family ownership.
 * "Out-of-estate" = irrevocable-trust-owned slices + the residual non-family
 *                   share of partially-family-owned business entities.
 *
 * Composes Phase 3's `ownersForYear` to get year-resolved ownership.
 */

import { ownersForYear } from "@/engine/ownership";
import type { AccountOwner } from "@/engine/ownership";
import type { ClientData, EntitySummary, GiftEvent } from "@/engine/types";

export interface ComputeAtYearArgs {
  tree: ClientData;
  giftEvents: GiftEvent[];
  year: number;
  projectionStartYear: number;
  accountBalances: Map<string, number>;
}

const BUSINESS_ENTITY_TYPES = new Set([
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "other",
]);

function isBusinessEntity(e: EntitySummary | undefined): boolean {
  return !!e && !!e.entityType && BUSINESS_ENTITY_TYPES.has(e.entityType);
}

/** Fraction of a non-trust entity owned by household family members. Missing
 *  `owners` is treated as fully family-owned for back-compat with legacy data
 *  imported before the entity_owners table existed. */
function familyOwnedFraction(entity: EntitySummary): number {
  if (entity.owners == null) return 1;
  const sum = entity.owners.reduce((s, o) => s + (o.percent ?? 0), 0);
  return Math.max(0, Math.min(1, sum));
}

function sumAccountsWhere(
  args: ComputeAtYearArgs,
  ownerWeight: (owner: AccountOwner) => number,
): number {
  const { tree, giftEvents, year, projectionStartYear, accountBalances } = args;
  let total = 0;
  for (const account of tree.accounts) {
    const owners = ownersForYear(account, giftEvents, year, projectionStartYear);
    const value = accountBalances.get(account.id) ?? account.value;
    for (const owner of owners) {
      const w = ownerWeight(owner);
      if (w > 0) total += value * owner.percent * w;
    }
  }
  return total;
}

function entityById(tree: ClientData, id: string | undefined): EntitySummary | undefined {
  if (!id) return undefined;
  return tree.entities?.find((e) => e.id === id);
}

/** In-estate weight (0–1) for an account-level owner slice. */
function inEstateWeight(tree: ClientData, owner: AccountOwner): number {
  if (owner.kind === "family_member") return 1;
  const entity = entityById(tree, owner.entityId);
  if (!entity) return 0;
  if (entity.entityType === "trust") return entity.isIrrevocable ? 0 : 1;
  if (isBusinessEntity(entity)) return familyOwnedFraction(entity);
  // foundations and unknown entity types: out-of-estate.
  return 0;
}

/** Out-of-estate weight (0–1) for an account-level owner slice. */
function outOfEstateWeight(tree: ClientData, owner: AccountOwner): number {
  if (owner.kind === "family_member") return 0;
  const entity = entityById(tree, owner.entityId);
  if (!entity) return 0;
  if (entity.entityType === "trust") return entity.isIrrevocable ? 1 : 0;
  if (isBusinessEntity(entity)) return 1 - familyOwnedFraction(entity);
  return 1;
}

/** Sum of business-entity flat valuations weighted by `weight(entity)`. */
function sumBusinessFlatValues(
  tree: ClientData,
  weight: (e: EntitySummary) => number,
): number {
  let total = 0;
  for (const e of tree.entities ?? []) {
    if (!isBusinessEntity(e)) continue;
    const v = e.value ?? 0;
    if (v <= 0) continue;
    total += v * weight(e);
  }
  return total;
}

// Note on orphan-entity references: when an account's owner.entityId doesn't
// resolve in tree.entities, both helpers return weight 0, dropping that slice
// from BOTH totals. The invariant `in + out === total` then breaks. Production
// data is FK-validated so this shouldn't trip; if loaders ever produce
// orphans, fix at the loader rather than papering over here.
export function computeInEstateAtYear(args: ComputeAtYearArgs): number {
  const accounts = sumAccountsWhere(args, (o) => inEstateWeight(args.tree, o));
  const flat = sumBusinessFlatValues(args.tree, (e) => familyOwnedFraction(e));
  return accounts + flat;
}

export function computeOutOfEstateAtYear(args: ComputeAtYearArgs): number {
  const accounts = sumAccountsWhere(args, (o) => outOfEstateWeight(args.tree, o));
  const flat = sumBusinessFlatValues(args.tree, (e) => 1 - familyOwnedFraction(e));
  return accounts + flat;
}
