import { is529Account } from "@/lib/accounts/is-529";
import type { AccountCategory, AccountSubType } from "@/lib/extraction/types";

/**
 * The category rule the commit path applies.
 *
 * Kept out of `commit/accounts.ts`, which imports `@/db/schema`, so code that
 * only reads extracted rows can apply the same rule without the schema. Its
 * only runtime dependency is `is-529.ts`, which is itself framework-free on
 * purpose.
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
