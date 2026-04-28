/**
 * Year-aware fractional sums of in-estate vs. out-of-estate value.
 *
 * "In-estate" = family-member-owned slices + revocable-trust-owned slices
 * "Out-of-estate" = irrevocable-trust-owned slices + non-trust-entity slices
 *
 * Composes Phase 3's `ownersForYear` to get year-resolved ownership.
 */

import { ownersForYear } from "@/engine/ownership";
import type { AccountOwner } from "@/engine/ownership";
import type { ClientData, GiftEvent } from "@/engine/types";

export interface ComputeAtYearArgs {
  tree: ClientData;
  giftEvents: GiftEvent[];
  year: number;
  projectionStartYear: number;
  accountBalances: Map<string, number>;
}

function sumWhere(
  args: ComputeAtYearArgs,
  ownerInScope: (owner: AccountOwner) => boolean,
): number {
  const { tree, giftEvents, year, projectionStartYear, accountBalances } = args;
  let total = 0;
  for (const account of tree.accounts) {
    const owners = ownersForYear(account, giftEvents, year, projectionStartYear);
    const value = accountBalances.get(account.id) ?? account.value;
    for (const owner of owners) {
      if (ownerInScope(owner)) {
        total += value * owner.percent;
      }
    }
  }
  return total;
}

export function computeInEstateAtYear(args: ComputeAtYearArgs): number {
  return sumWhere(args, (owner) => {
    if (owner.kind === "family_member") return true;
    const entity = args.tree.entities?.find((e) => e.id === owner.entityId);
    if (!entity) return false;
    if (entity.entityType === "trust") return entity.isIrrevocable !== true;
    return false; // non-trust entities (LLC, foundation, etc.) — out-of-estate
  });
}

export function computeOutOfEstateAtYear(args: ComputeAtYearArgs): number {
  return sumWhere(args, (owner) => {
    if (owner.kind === "family_member") return false;
    const entity = args.tree.entities?.find((e) => e.id === owner.entityId);
    if (!entity) return false;
    if (entity.entityType === "trust") return entity.isIrrevocable === true;
    return true;
  });
}
