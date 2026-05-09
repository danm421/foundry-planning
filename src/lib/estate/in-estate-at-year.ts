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
import {
  familyOwnedFraction,
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
    const owners = ownersForYear(account, giftEvents, year, projectionStartYear);
    const value = accountBalances.get(account.id) ?? account.value;

    // Per-account locked-share resolution mirrors balance-sheet view-model:
    // entity slice = locked share when available; family slice = locked share
    // when available, else (value − Σ entity locked) × percent / Σ family
    // percents. Falls back to authored value × percent when no locked data.
    let totalEntityShare = 0;
    let familyPercentTotal = 0;
    for (const o of owners) {
      if (o.kind === "entity") {
        const locked = entityAccountSharesEoY?.get(o.entityId)?.get(account.id);
        totalEntityShare += locked ?? value * o.percent;
      } else {
        familyPercentTotal += o.percent;
      }
    }
    const familyPool = Math.max(0, value - totalEntityShare);

    for (const owner of owners) {
      const w = ownerWeight(owner);
      if (w <= 0) continue;
      let sliceValue: number;
      if (owner.kind === "entity") {
        const locked = entityAccountSharesEoY?.get(owner.entityId)?.get(account.id);
        sliceValue = locked ?? value * owner.percent;
      } else {
        const lockedFm = familyAccountSharesEoY
          ?.get(owner.familyMemberId)
          ?.get(account.id);
        if (lockedFm != null) {
          sliceValue = lockedFm;
        } else {
          sliceValue =
            familyPercentTotal > 0
              ? familyPool * (owner.percent / familyPercentTotal)
              : value * owner.percent;
        }
      }
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
  const flat = sumBusinessFlatValues(args.tree, (e) => familyOwnedFraction(e));
  return accounts + flat;
}

export function computeOutOfEstateAtYear(args: ComputeAtYearArgs): number {
  const accounts = sumAccountsWhere(args, (o) => outOfEstateWeight(args.tree, o));
  const flat = sumBusinessFlatValues(args.tree, (e) => 1 - familyOwnedFraction(e));
  return accounts + flat;
}
