import { ownersForYear } from "@/engine/ownership";
import type { AccountOwner } from "@/engine/ownership";
import type { Account, GiftEvent } from "@/engine/types";

/** Synthetic ownership for an account that carries no account_owners rows
 *  (e.g. `is_default_checking` pooled household cash). A single family-member
 *  owner makes the slice fully in-estate. The id is a sentinel — it never
 *  resolves to a real family member; ownership-weight functions and slice
 *  resolvers key only on `owner.kind`. */
const HOUSEHOLD_OWNER_FALLBACK: AccountOwner[] = [
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
