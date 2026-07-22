import { eq } from "drizzle-orm";

import { expenseDedicatedAccounts } from "@/db/schema";
import type { Tx } from "@/lib/imports/commit/types";

/**
 * Replace an expense's dedicated-funding accounts, in draw order.
 *
 * Defined exactly once and called from BOTH the advisor-facing write core
 * (`expenses-writes.ts`) and the import commit path (`commit/goals.ts`).
 * `commit/goals.ts` cannot reuse `createExpenseForClient` — that opens its own
 * `db.transaction`, and a commit module must write inside the caller's `tx` so
 * a rollback takes its rows with it. Sharing this function is what keeps the
 * two paths from drifting.
 *
 * Full replace, not a diff: `sortOrder` is positional, so a diff would have to
 * renumber survivors anyway.
 */
export async function replaceDedicatedAccounts(
  tx: Tx,
  expenseId: string,
  accountIds: string[],
): Promise<void> {
  await tx.delete(expenseDedicatedAccounts).where(eq(expenseDedicatedAccounts.expenseId, expenseId));
  if (accountIds.length === 0) return;
  await tx.insert(expenseDedicatedAccounts).values(
    accountIds.map((accountId, i) => ({ expenseId, accountId, sortOrder: i })),
  );
}
