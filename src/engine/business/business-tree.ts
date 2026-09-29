import type { ProjectionYear } from "../types";

/** Minimal account shape the tree walk needs. The engine passes full
 *  `Account`s; the balance-sheet report passes its slimmer `AccountLike`. */
interface TreeNode {
  id: string;
  parentAccountId?: string | null;
}

/**
 * Return the business account plus every descendant account reachable via
 * parentAccountId. Cycle-safe via a visited set. Order is parent-first then
 * depth-first. Generic over any node carrying `id` + `parentAccountId` so
 * callers with reduced account shapes can reuse it.
 */
export function collectBusinessTree<T extends TreeNode>(rootId: string, accounts: T[]): T[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const root = byId.get(rootId);
  if (!root) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  const stack: T[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    out.push(cur);
    for (const a of accounts) {
      if (a.parentAccountId === cur.id && !seen.has(a.id)) stack.push(a);
    }
  }
  return out;
}

/**
 * Consolidated value of a business: the business account's own `value` plus
 * the year-end balance of every descendant account. Mirrors what
 * `businessConsolidatedValue` did before — same drained-account exclusion
 * (balance ≤ 0 → skipped, even the parent).
 */
export function consolidatedBusinessValue<T extends TreeNode>(
  rootId: string,
  accounts: T[],
  accountBalances: Record<string, number>,
): number {
  const tree = collectBusinessTree(rootId, accounts);
  let total = 0;
  for (const a of tree) {
    const bal = accountBalances[a.id] ?? 0;
    if (bal <= 0) continue;
    total += bal;
  }
  return total;
}

/**
 * The value an asset gift of `accountId` is a percentage of, read from
 * `accountBalances`.
 *
 * A top-level business is valued as ONE thing: parent flat value plus every
 * descendant's balance — `consolidatedBusinessValue`, the same valuation the
 * gross estate removes a gifted share of. The gift side read the parent's own
 * balance, so a gift of a business with children removed more from the estate
 * than it consumed in exemption. Every other account (a child account gifted on
 * its own included) is its own balance.
 */
export function giftValueOfAccount<T extends TreeNode & { category: string }>(
  accountId: string,
  accounts: T[],
  accountBalances: Record<string, number>,
): number {
  const account = accounts.find((a) => a.id === accountId);
  if (account?.category === "business" && account.parentAccountId == null) {
    return consolidatedBusinessValue(accountId, accounts, accountBalances);
  }
  return accountBalances[accountId] ?? 0;
}

/**
 * Build the resolver an asset gift is valued with: the gift year's closing
 * balances (`accountLedgers[*].endingValue`) through `giftValueOfAccount`, so
 * a top-level business is its consolidated value.
 *
 * The one definition for the engine's gift ledger (`runProjectionWithEvents`)
 * and every advisor surface that previews, reports on, or sizes an asset gift
 * (`lib/estate/account-value-at-year.ts`). Two copies could quote a different
 * number than the exemption the gift actually consumes.
 *
 * Returns undefined when the projection holds no row for that year or no
 * ledger for that account (a gift dated before plan start, a pre-activation
 * account). The ledger treats that as 0; advisor surfaces keep the distinction.
 * `accounts` is the list the projection ran on (`ClientData.accounts`).
 */
export function buildGiftValueAtYear<T extends TreeNode & { category: string }>(
  years: ProjectionYear[],
  accounts: T[],
): (accountId: string, year: number) => number | undefined {
  const yearByYear = new Map(years.map((y) => [y.year, y]));
  return (accountId, year) => {
    const ledgers = yearByYear.get(year)?.accountLedgers;
    if (ledgers?.[accountId] == null) return undefined;
    const balances: Record<string, number> = {};
    for (const [id, ledger] of Object.entries(ledgers)) balances[id] = ledger.endingValue;
    return giftValueOfAccount(accountId, accounts, balances);
  };
}
