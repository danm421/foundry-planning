import type { Account } from "../types";
import { consolidatedBusinessValue } from "../business/business-tree";

/**
 * Canonical business asset total value: the business account's own value plus
 * every child account's balance reachable via `parentAccountId`. Single source
 * of truth shared by `computeGrossEstate`'s business-consolidation loop and
 * `applyBusinessSuccession` — both must call this helper.
 *
 * Drained accounts (balance ≤ 0) are excluded.
 */
export function businessConsolidatedValue(
  business: Account,
  accounts: Account[],
  accountBalances: Record<string, number>,
): number {
  return consolidatedBusinessValue(business.id, accounts, accountBalances);
}
