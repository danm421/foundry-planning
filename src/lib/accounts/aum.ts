// Which account categories a firm can bill on. These are the only categories
// eligible for the per-account `counts_toward_aum` flag, and the only ones the
// home screen's "Total book value" KPI sums.
//
// NOTE: these are the same three values as LIQUID_CATEGORIES in
// lib/estate/yearly-liquidity-report.ts and LiquidAccount in
// components/account-groups/types.ts — that is a coincidence, not a
// dependency. Those answer "what can be sold to pay estate tax"; this answers
// "what can the firm bill on". Keep them independent so a future change to
// estate liquidity never silently moves the book value.

export const AUM_ELIGIBLE_CATEGORIES = ["taxable", "cash", "retirement"] as const;

const ELIGIBLE: ReadonlySet<string> = new Set(AUM_ELIGIBLE_CATEGORIES);

/**
 * True when `category` (an `account_category` enum value) may carry the
 * counts-toward-AUM flag. Unknown categories are ineligible — a category this
 * module has never heard of must not silently join the book.
 */
export function isAumEligible(category: string): boolean {
  return ELIGIBLE.has(category);
}
