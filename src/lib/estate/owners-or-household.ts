import { ownersForYear } from "@/engine/ownership";
import type { AccountOwner } from "@/engine/ownership";
import type { Account, GiftEvent } from "@/engine/types";

/** Synthetic ownership for an account that carries no account_owners rows
 *  (e.g. `is_default_checking` pooled household cash). A single family-member
 *  owner makes the slice fully in-estate. The id is a sentinel — it never
 *  resolves to a real family member; ownership-weight functions and slice
 *  resolvers key only on `owner.kind`. */
export const HOUSEHOLD_OWNER_FALLBACK: AccountOwner[] = [
  { kind: "family_member", familyMemberId: "__no_owner_household__", percent: 1 },
];

/**
 * Like `ownersForYear`, but tolerates an account with no owner rows by
 * treating it as fully household-owned instead of throwing on the sum-to-1
 * check. Default-checking accounts are pooled household cash and legitimately
 * carry no `account_owners` rows — mirrors the entity back-compat in
 * `familyOwnedFraction`.
 */
export function ownersForYearOrHousehold(
  account: Account,
  giftEvents: GiftEvent[],
  year: number,
  projectionStartYear: number,
): AccountOwner[] {
  if (account.owners && account.owners.length > 0) {
    return ownersForYear(account, giftEvents, year, projectionStartYear);
  }
  return HOUSEHOLD_OWNER_FALLBACK;
}

/**
 * `ownersForYearOrHousehold`, but malformed gift events (an overdrawn household
 * share, or composed owners that don't sum to 1) fall back to the account's
 * authored owners instead of throwing. Report surfaces prefer a slightly stale
 * ownership split over a blank screen.
 *
 * Note the fallback is the AUTHORED owners, never `[]` — an account with no
 * owner rows still resolves through `HOUSEHOLD_OWNER_FALLBACK` above, so pooled
 * default-checking cash keeps a household owner rather than being dropped.
 */
export function ownersForYearSafe(
  account: Account,
  giftEvents: GiftEvent[],
  year: number,
  projectionStartYear: number,
): AccountOwner[] {
  try {
    return ownersForYearOrHousehold(account, giftEvents, year, projectionStartYear);
  } catch {
    return account.owners ?? HOUSEHOLD_OWNER_FALLBACK;
  }
}
