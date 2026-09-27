import type { AccountOwner } from "@/engine/ownership";
import type { PublishedAccountOwnership } from "@/engine/types";

export interface OwnerSlice {
  owner: AccountOwner;
  /** Dollar value of this owner's slice of the account at the resolved balance. */
  value: number;
}

/**
 * Split an account's resolved balance into per-owner dollar slices using the
 * engine's locked shares.
 *
 * An entity's slice is its locked EoY share (`entityAccountSharesEoY`) so
 * household cash flows on a split-owned account never bleed into the entity's
 * portion — the household drawdown lands on the family-member owners, who
 * share the residual `value − Σ entity slices`. A family member's slice uses
 * `familyAccountSharesEoY` when present (jointly-held drift), else its share
 * of the residual pool by relative percent.
 *
 * A `gifted_away` slice (a lifetime asset gift to a person or charity) holds
 * its own dollars — `value × percent` — and is subtracted from the family pool
 * so the remaining family members do NOT re-absorb what was given away. This
 * mirrors the death-time gross-estate math in
 * `engine/death-event/estate-tax.ts`, which subtracts `totalGiftedAway` from
 * its family pool for the same reason.
 *
 * Locked family shares are gift-blind toward `gifted_away`: `computeFamilyAccountShares`
 * resolves owners per year and debits every asset gift, but its settle step
 * rescales the shares to `endingValue − Σ entity locks`, a pool that still
 * INCLUDES any slice gifted to a person. So they carry the pre-gift family
 * pool with respect to gifted-away rows. They are scaled by `familyPool / familyPoolPreGift` — both dollar
 * figures, so the rescale stays consistent with an entity slice that has
 * drifted from its authored percent. With no gifted-away rows the two pools are
 * equal, the factor is 1, and locked shares pass through untouched.
 *
 * Falls back to `value × authoredPercent` when no locked-share data is
 * supplied (e.g. the as-of-today view, before any projected flows). This is
 * the same resolution the gross-estate and balance-sheet reports use.
 */
export function resolveOwnerSlices(
  accountId: string,
  owners: AccountOwner[],
  value: number,
  entityAccountSharesEoY?: Map<string, Map<string, number>>,
  familyAccountSharesEoY?: Map<string, Map<string, number>>,
): OwnerSlice[] {
  let totalEntityShare = 0;
  let familyPercentTotal = 0;
  let giftedAwayPercentTotal = 0;
  for (const o of owners) {
    if (o.kind === "entity") {
      const locked = entityAccountSharesEoY?.get(o.entityId)?.get(accountId);
      totalEntityShare += locked ?? value * o.percent;
    } else if (o.kind === "family_member") {
      familyPercentTotal += o.percent;
    } else if (o.kind === "gifted_away") {
      giftedAwayPercentTotal += o.percent;
    }
    // external_beneficiary rows carry no current balance-sheet value — they
    // describe death-benefit payouts, not present ownership.
  }
  const familyPoolPreGift = Math.max(0, value - totalEntityShare);
  const familyPool = Math.max(
    0,
    familyPoolPreGift - value * giftedAwayPercentTotal,
  );
  // Rescales gift-blind locked family shares onto the post-gift family pool.
  // Derived from the same dollar figures as `familyPool` so both branches of
  // the map below shrink by exactly the same amount.
  const lockedFmFactor =
    familyPoolPreGift > 0 ? familyPool / familyPoolPreGift : 1;

  return owners.map((owner) => {
    if (owner.kind === "entity") {
      const locked = entityAccountSharesEoY?.get(owner.entityId)?.get(accountId);
      return { owner, value: locked ?? value * owner.percent };
    }
    if (owner.kind === "external_beneficiary") {
      return { owner, value: 0 };
    }
    // Gifted away during life — out of the estate, but it still holds real
    // dollars on the recipient's side. Callers decide inclusion via
    // `inEstateWeight` / `outOfEstateWeight`, both of which weigh it 0.
    if (owner.kind === "gifted_away") {
      return { owner, value: value * owner.percent };
    }
    const lockedFm = familyAccountSharesEoY
      ?.get(owner.familyMemberId)
      ?.get(accountId);
    if (lockedFm != null) return { owner, value: lockedFm * lockedFmFactor };
    return {
      owner,
      value:
        familyPercentTotal > 0
          ? familyPool * (owner.percent / familyPercentTotal)
          : value * owner.percent,
    };
  });
}

/** The projection-year fields `accountSlicesAtYear` reads. */
export interface AccountSlicesYear {
  accountOwners?: Map<string, PublishedAccountOwnership>;
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
}

/** A first-death partition rebuilt this authored account in this year: its
 *  pool carries the `giftsReflectedThrough` marker, or accounts the death
 *  carved out of it carry `sliceOf`. */
export function isPartitionedAt(yearRow: AccountSlicesYear, accountId: string): boolean {
  if (yearRow.accountOwners?.get(accountId)?.giftsReflectedThrough != null) return true;
  for (const rec of yearRow.accountOwners?.values() ?? []) {
    if (rec.sliceOf === accountId) return true;
  }
  return false;
}

/** Same owner, for folding a carved-out account's slice into its origin's. */
function sameOwner(a: AccountOwner, b: AccountOwner): boolean {
  if (a.kind === "entity" && b.kind === "entity") return a.entityId === b.entityId;
  if (a.kind === "family_member" && b.kind === "family_member") return a.familyMemberId === b.familyMemberId;
  return false;
}

/**
 * Per-owner dollar slices of an AUTHORED account in a projection year,
 * death-aware. Unless a death partitioned the account this is exactly
 * `resolveOwnerSlices(account.id, fallbackOwners(), value, …)`.
 *
 * A first-death partition leaves the account as several engine accounts: the
 * family pool under the ORIGINAL id — already net of every gift through the
 * death (`giftsReflectedThrough`) — plus one 100% entity slice per entity
 * owner, and possibly a will's split of the pool, each tagged `sliceOf` = this
 * account. The authored rows plus the gift overlay describe none of them: they
 * re-apply the gifts to the pool's ledger and never see the slices. So a
 * partitioned pool takes its owners from the engine's published ownership,
 * and every account carved out of it is folded back in as its owner's slice
 * of this account. A pool that did not survive the death (a will split it)
 * contributes only what was carved out of it.
 */
export function accountSlicesAtYear(args: {
  account: { id: string };
  yearRow: AccountSlicesYear | undefined;
  /** The caller's value for any account id — the pool and every carved-out one. */
  valueOf: (accountId: string) => number;
  /** The caller's own resolution of the authored rows (gift overlay applied). */
  fallbackOwners: () => AccountOwner[];
  /** `account.id`'s value when the caller's differs from `valueOf` (e.g. a
   *  consolidated business). Defaults to `valueOf(account.id)`. */
  value?: number;
}): OwnerSlice[] {
  const { account, yearRow, valueOf, fallbackOwners } = args;
  const ent = yearRow?.entityAccountSharesEoY;
  const fam = yearRow?.familyAccountSharesEoY;
  const carved: OwnerSlice[] = [];
  for (const [id, rec] of yearRow?.accountOwners ?? []) {
    if (rec.sliceOf !== account.id) continue;
    carved.push(...resolveOwnerSlices(id, rec.owners, valueOf(id), ent, fam));
  }
  const published = yearRow?.accountOwners?.get(account.id);
  if (carved.length > 0 && !published) return carved;
  const owners = published?.giftsReflectedThrough != null ? published.owners : fallbackOwners();
  const slices = resolveOwnerSlices(account.id, owners, args.value ?? valueOf(account.id), ent, fam);
  // One owner, one slice: a post-death gift of the pool to a trust that
  // already holds a slice of it adds to that trust's slice.
  for (const c of carved) {
    const same = slices.find((s) => sameOwner(s.owner, c.owner));
    if (same) same.value += c.value;
    else slices.push(c);
  }
  return slices;
}

/**
 * A partitioned account (see {@link isPartitionedAt}) as ONE account: the
 * pool plus every account carved out of it, valued together, with one owner
 * row per owner giving that owner's share of the whole. For readers that
 * work in `value × owner.percent` rather than in slices (the estate canvas,
 * the Balance Sheet's household columns).
 */
export function foldPartitionedAccount(args: {
  account: { id: string };
  yearRow: AccountSlicesYear;
  valueOf: (accountId: string) => number;
  fallbackOwners: () => AccountOwner[];
}): { value: number; owners: AccountOwner[] } {
  const slices = accountSlicesAtYear(args);
  const value = slices.reduce((sum, sl) => sum + sl.value, 0);
  if (value <= 0) return { value: 0, owners: [] };
  return { value, owners: slices.map((sl) => ({ ...sl.owner, percent: sl.value / value })) };
}
