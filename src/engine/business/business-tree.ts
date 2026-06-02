import type { Account } from "../types";

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
export function consolidatedBusinessValue(
  rootId: string,
  accounts: Account[],
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
