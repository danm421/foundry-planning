/**
 * Year-aware fractional sums of in-estate vs. out-of-estate value.
 *
 * "In-estate" = family-member-owned slices + revocable-trust-owned slices
 *               + family-owned business-entity slices (LLC / S-Corp / etc.)
 *               + flat business-entity valuations weighted by recursive
 *                 in-estate weight (handles trust-owned and chain-held
 *                 businesses — e.g. LLC owned by a revocable trust is fully
 *                 in-estate; LLC owned by an ILIT is fully out).
 * "Out-of-estate" = irrevocable-trust-owned slices + the residual non-in-estate
 *                   share of partially-family-or-trust-owned business entities.
 *
 * Composes Phase 3's `ownersForYear` to get year-resolved ownership.
 */

import type { AccountOwner } from "@/engine/ownership";
import type { ClientData, EntitySummary, GiftEvent } from "@/engine/types";
import { resolveOwnerSlices } from "./account-owner-slices";
import { ownersForYearOrHousehold } from "./owners-or-household";
import {
  entityInEstateWeight,
  inEstateWeight,
  isBusinessEntity,
  outOfEstateWeight,
} from "./in-estate-weights";

export interface ComputeAtYearArgs {
  tree: ClientData;
  giftEvents: GiftEvent[];
  year: number;
  projectionStartYear: number;
  accountBalances: Map<string, number>;
  /** Engine-published locked entity slice EoY (entityId → accountId → dollars).
   *  Pass `yearRow.entityAccountSharesEoY` so household withdrawals on a
   *  split-owned account don't bleed into the entity's slice. Same source the
   *  balance sheet uses. Optional — falls back to `value × authored percent`. */
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  /** Engine-published locked family-member slice EoY (fmId → accountId → dollars).
   *  Used for jointly-held family accounts where ownership drifts year-to-year. */
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
}

function sumAccountsWhere(
  args: ComputeAtYearArgs,
  ownerWeight: (owner: AccountOwner) => number,
): number {
  const {
    tree,
    giftEvents,
    year,
    projectionStartYear,
    accountBalances,
    entityAccountSharesEoY,
    familyAccountSharesEoY,
  } = args;
  let total = 0;
  for (const account of tree.accounts) {
    const owners = ownersForYearOrHousehold(
      account,
      giftEvents,
      year,
      projectionStartYear,
    );
    const value = accountBalances.get(account.id) ?? account.value;

    // Locked-share slice resolution (entity slice = locked EoY share; family
    // members absorb the residual) — shared with the Estate Flow ownership
    // column; mirrors the balance-sheet view-model's own copy.
    const slices = resolveOwnerSlices(
      account.id,
      owners,
      value,
      entityAccountSharesEoY,
      familyAccountSharesEoY,
    );
    for (const { owner, value: sliceValue } of slices) {
      const w = ownerWeight(owner);
      if (w <= 0) continue;
      total += sliceValue * w;
    }
  }
  return total;
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
  const flat = sumBusinessFlatValues(args.tree, (e) =>
    entityInEstateWeight(args.tree, e.id),
  );
  return accounts + flat;
}

export function computeOutOfEstateAtYear(args: ComputeAtYearArgs): number {
  const accounts = sumAccountsWhere(args, (o) => outOfEstateWeight(args.tree, o));
  const flat = sumBusinessFlatValues(
    args.tree,
    (e) => 1 - entityInEstateWeight(args.tree, e.id),
  );
  return accounts + flat;
}
