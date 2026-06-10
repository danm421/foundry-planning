import type { Account } from "@/engine/types";
import type { SolverMutation } from "./types";

/** Categories that ordinarily pass through probate and therefore benefit from
 *  a revocable-trust tag. Beneficiary-by-nature categories (retirement,
 *  annuity, life_insurance) are excluded — they avoid probate already.
 *
 *  This is the exact complement, by category, of the engine's non-probate set.
 *  If `Account["category"]` gains a new member, decide whether it belongs here
 *  or in the exclusion set — the source of truth for which categories avoid
 *  probate is `isNonProbateAccount` in src/engine/death-event/estate-tax.ts.
 *  (Don't derive this list from that function: it also folds in instance-level
 *  checks — joint ownership, named beneficiary, existing trust — that don't
 *  belong in a category-level constant.) */
export const REVOCABLE_TRUST_ELIGIBLE_CATEGORIES: readonly Account["category"][] = [
  "cash",
  "taxable",
  "real_estate",
  "business",
  "stock_options",
  "notes_receivable",
];

/** True when the account is eligible to be moved into a revocable trust via
 *  the solver lever: the category passes through probate AND it is not already
 *  tagged into a revocable trust. */
export function isRevocableTagEligible(a: Account): boolean {
  return (
    REVOCABLE_TRUST_ELIGIBLE_CATEGORIES.includes(a.category) &&
    a.revocableTrustName == null
  );
}

/**
 * Build the `account-upsert` mutations that move the selected accounts into a
 * revocable living trust (and clear the tag on eligible accounts that are no
 * longer selected, so un-checking reverts).
 *
 * Rules:
 * - Selected + eligible → tag with `trustName`.
 * - Not selected + eligible + no pre-existing tag → emit null-clearing upsert
 *   (unselecting reverts a previously-set tag from this lever).
 * - Not selected + eligible + pre-existing tag (from a different trust) → skip
 *   (leave the advisor's base-data tag alone).
 * - Ineligible category → never touched.
 */
export function buildRevocableTagMutations(
  accounts: Account[],
  taggedIds: Set<string>,
  trustName: string,
): SolverMutation[] {
  const muts: SolverMutation[] = [];
  for (const a of accounts) {
    if (!REVOCABLE_TRUST_ELIGIBLE_CATEGORIES.includes(a.category)) continue;
    // Leave pre-existing base tags (from a different revocable trust) alone.
    if (a.revocableTrustName != null && !taggedIds.has(a.id)) continue;
    const revocableTrustName = taggedIds.has(a.id) ? trustName : null;
    muts.push({
      kind: "account-upsert",
      id: a.id,
      value: { ...a, revocableTrustName },
    });
  }
  return muts;
}
