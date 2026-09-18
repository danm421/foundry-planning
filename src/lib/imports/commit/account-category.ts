import { is529Account } from "@/lib/accounts/is-529";
import type { AccountCategory, AccountSubType } from "@/lib/extraction/types";

/**
 * The category rule the commit path applies, and the one review-surface test
 * that depends on it.
 *
 * Lifted out of `commit/accounts.ts` (final review I5) for the same reason
 * `mortgage-link.ts` was lifted out of `assemble/`: a `"use client"` review
 * table has to ask what the commit will ACTUALLY write, and `commit/accounts.ts`
 * imports `@/db/schema` — reaching it from the browser bundle would drag the
 * whole schema in. Both files here have no runtime dependency beyond
 * `is-529.ts`, which is itself framework-free on purpose.
 *
 * `commit/accounts.ts` re-exports `resolveAccountCategory`, so every existing
 * import path keeps resolving and there is still only ONE definition.
 */

/**
 * The account category to persist. Extraction historically classified 529s as
 * `taxable` + `subType: "529"` because `education_savings` was not in its
 * category union at all (fixed in the prompt, but old payloads persist and the
 * model can still ignore the rule). A 529 left as `taxable` is spendable in the
 * withdrawal waterfall and invisible to the dedicated-funding picker, so the
 * subType wins here.
 */
export function resolveAccountCategory(
  row: { name?: string; category?: AccountCategory; subType?: AccountSubType },
): AccountCategory {
  if (is529Account(row)) return "education_savings";
  return row.category ?? "taxable";
}

/**
 * A row `commitAccounts` would write to the balance sheet as a $0 house.
 *
 * `splitMortgageEscrow` deliberately synthesizes its property with NO `value`
 * — "a mortgage statement never says what the home is worth, and a 0 would
 * render as a worthless house". That reasoning stops at the commit boundary:
 * `commit/accounts.ts` coerces an absent value to `"0"`, so the row lands as a
 * real-estate account worth nothing with a real mortgage against it, and the
 * projection grows a $0 asset forever (final review I5).
 *
 * Asks `resolveAccountCategory`, not `row.category`: the displayed category is
 * not always the one that commits. Measured, the two differ on exactly one
 * shape — `{ category: "real_estate", subType: "529" }`, which commits as
 * `education_savings` — and that row is correctly NOT treated as a house here.
 */
export function isUnpricedProperty(row: {
  name?: string;
  category?: AccountCategory;
  subType?: AccountSubType;
  value?: number;
}): boolean {
  return row.value == null && resolveAccountCategory(row) === "real_estate";
}
