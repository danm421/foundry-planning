/**
 * Year-aware fractional sums of in-estate vs. out-of-estate value.
 *
 * "In-estate"     = family-member-owned slices + revocable-trust-owned slices.
 * "Out-of-estate" = irrevocable-trust-owned slices.
 *
 * Composes Phase 3's `ownersForYear` to get year-resolved ownership.
 *
 * Businesses are accounts in the business-as-asset model. The parent business
 * account's `accountBalances` entry is its flat operating value only; child
 * business sub-accounts roll up via `consolidatedBusinessValue`. To avoid
 * double-counting, the per-account loop skips children and consolidates each
 * top-level business at its tree total.
 */

import type { AccountOwner } from "@/engine/ownership";
import type { ClientData, GiftEvent } from "@/engine/types";
import { resolveOwnerSlices } from "./account-owner-slices";
import { ownersForYearOrHousehold } from "./owners-or-household";
import {
  inEstateWeight,
  outOfEstateWeight,
} from "./in-estate-weights";
import { consolidatedBusinessValue } from "@/engine/business/business-tree";

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
  education529Weight: 0 | 1,
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

  // Convert the Map balances to a Record for `consolidatedBusinessValue`,
  // which works in Record-shape balances (matches death-event call sites).
  const balancesRecord: Record<string, number> = {};
  for (const [id, bal] of accountBalances) balancesRecord[id] = bal;

  let total = 0;
  for (const account of tree.accounts) {
    // Business child accounts roll into their parent — skip them so their
    // value isn't counted twice (once via the parent's consolidated tree
    // and once on its own row).
    if (account.parentAccountId != null) continue;

    // 529s: no household/entity owners (sentinel external_beneficiary only).
    // They are categorically OUT of the estate — count fully in the
    // out-of-estate sum, never in the in-estate sum.
    if (account.category === "education_savings") {
      total += (accountBalances.get(account.id) ?? account.value) * education529Weight;
      continue;
    }

    const owners = ownersForYearOrHousehold(
      account,
      giftEvents,
      year,
      projectionStartYear,
    );

    // For top-level business accounts, value = parent flat value + every
    // descendant's balance (the canonical "one business = one value" rule).
    // For everything else, value = the account's own year-resolved balance.
    const isTopLevelBusiness =
      account.category === "business" && account.parentAccountId == null;
    const value = isTopLevelBusiness
      ? consolidatedBusinessValue(account.id, tree.accounts, balancesRecord)
      : accountBalances.get(account.id) ?? account.value;

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

// Note on orphan-entity references: when an account's owner.entityId doesn't
// resolve in tree.entities, both helpers return weight 0, dropping that slice
// from BOTH totals. The invariant `in + out === total` then breaks. Production
// data is FK-validated so this shouldn't trip; if loaders ever produce
// orphans, fix at the loader rather than papering over here.
export function computeInEstateAtYear(args: ComputeAtYearArgs): number {
  return sumAccountsWhere(args, (o) => inEstateWeight(args.tree, o), 0);
}

export function computeOutOfEstateAtYear(args: ComputeAtYearArgs): number {
  return sumAccountsWhere(args, (o) => outOfEstateWeight(args.tree, o), 1);
}
