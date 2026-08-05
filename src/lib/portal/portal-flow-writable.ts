// Which cash-flow rows a PORTAL CLIENT may write. The single source of truth
// for that question: `load-organizer-map.ts` calls these to decide which cards
// render with an editor, and every `/api/portal/{incomes,expenses,savings-rules}`
// handler calls them again to refuse a hand-rolled request. One module, so the
// UI and the API cannot disagree.
//
// Strictly narrower than the advisor's `isHydratableIncome`/`isHydratableExpense`
// (`@/lib/household-map/map-items`), which asks a different question: "can the
// quick-edit drawer safely hydrate this?" A row can be perfectly hydratable for
// an advisor and still be off-limits to a client.
import { isSocialSecurityIncome } from "@/lib/household-map/social-security";
import { isPortalVisibleAccount } from "./account-visibility";
import type { Expense, Income, SavingsRule } from "@/engine/types";

/** Entity- or business-account-owned flows. Their raw amounts are not household
 *  cash — business rows reach it only via the distribution sweep — and the
 *  boards already tray them because no owner column can honestly hold them. A
 *  client has no standing to edit an S-corp's gross revenue from a personal
 *  portal. */
function isTrayOwned(flow: { ownerEntityId?: string | null; ownerAccountId?: string | null }): boolean {
  return flow.ownerEntityId != null || flow.ownerAccountId != null;
}

/**
 * 1. `source: "policy"` — re-derived from life-insurance accounts on every load.
 *    No DB row exists, so no write path can accept the id (base PUT hits a uuid
 *    column and 500s).
 * 2. Social security — carries five claim-strategy fields (`claimingAge`,
 *    `claimingAgeMonths`, `claimingAgeMode`, `piaMonthly`, `ssBenefitMode`) that
 *    the portal's simplified form does not render, and in `pia_at_fra` mode
 *    `annualAmount` is not even the row's number. Advisor lever; stays read-only.
 * 3. Tray-owned — see `isTrayOwned`.
 */
export function isPortalWritableIncome(
  income: Pick<Income, "source" | "type" | "ownerEntityId" | "ownerAccountId">,
): boolean {
  if (income.source === "policy") return false;
  if (isSocialSecurityIncome(income)) return false;
  return !isTrayOwned(income);
}

/** Expense counterpart. No expense type carries a hidden field set the way
 *  social security does, so only the synthesized `premium-<uuid>` policy rows
 *  and tray-owned rows are refused. Note `deleteExpenseForClient` separately
 *  refuses `isDefault` living-expense rows — that guard is not duplicated here,
 *  because those rows remain perfectly EDITABLE. */
export function isPortalWritableExpense(
  expense: Pick<Expense, "source" | "ownerEntityId" | "ownerAccountId">,
): boolean {
  if (expense.source === "policy") return false;
  return !isTrayOwned(expense);
}

/**
 * A savings rule is portal-writable only when it resolves to a FLAT DOLLAR
 * amount and funds an account the client can already see.
 *
 * The three excluded modes mirror `resolveSavings` in
 * `@/lib/household-map/map-items`, which already sets `editableAmount: null` for
 * each: a schedule is year-by-year, `contributeMax` is an IRS limit resolved
 * from the owner's age, and percent-of-pay needs their salary slice. All three
 * are computed in the projection, so a number typed over them is a number the
 * engine discards.
 *
 * The account gate is `isPortalVisibleAccount`, the same predicate the portal
 * Accounts list and the portal account routes use. Consequence worth knowing:
 * `education_savings` is not a portal-visible category, so a client cannot add
 * or edit a 529 contribution from the portal. That is deliberate under the
 * current visibility rules, not an oversight.
 */
export function isPortalWritableSavingsRule(
  rule: Pick<SavingsRule, "accountId" | "annualPercent" | "contributeMax" | "scheduleOverrides">,
  accountById: ReadonlyMap<
    string,
    { category: string; isDefaultChecking?: boolean; parentAccountId?: string | null }
  >,
): boolean {
  if (rule.scheduleOverrides && Object.keys(rule.scheduleOverrides).length > 0) return false;
  if (rule.contributeMax) return false;
  if (rule.annualPercent != null && rule.annualPercent > 0) return false;

  const account = accountById.get(rule.accountId);
  if (!account) return false;
  return isPortalVisibleAccount({
    category: account.category,
    isDefaultChecking: account.isDefaultChecking ?? false,
    parentAccountId: account.parentAccountId ?? null,
  });
}
