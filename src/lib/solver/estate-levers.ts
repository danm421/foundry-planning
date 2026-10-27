import type { Account } from "@/engine/types";

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
