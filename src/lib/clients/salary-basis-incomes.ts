import { eq } from "drizzle-orm";

import { db } from "@/db";
import { savingsRuleSalaryIncomes } from "@/db/schema";

// Declared locally, matching the other `lib/clients` write modules.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Replace the salaries a savings rule's percent resolves against.
 *
 * Defined once and called from both the advisor/portal write core
 * (`savings-rules-writes.ts`) and the scenario-promotion writer, which must
 * write inside its caller's `tx` so a rollback takes its rows with it.
 *
 * Full replace, not a diff: `sortOrder` is positional, so a diff would have to
 * renumber survivors anyway. Same reasoning, and same shape, as
 * `replaceDedicatedAccounts`.
 *
 * De-duplicates. `expenses-writes.ts` does the equivalent one level up, in
 * `dedupeDedicatedIds`, because `replaceDedicatedAccounts` has exactly one
 * caller shape; this one is also called directly by the scenario-promotion
 * writer, so the invariant belongs where every caller inherits it. It matters
 * twice over: the table's UNIQUE(savings_rule_id, income_id) turns a repeat
 * into a raw 500, and projection.ts sums `salaryIncomeIds` with no de-dup of
 * its own, so any repeat that survived would double-count that salary. First
 * occurrence wins, so the caller's draw order is preserved.
 */
export async function replaceSalaryIncomes(
  tx: Tx,
  savingsRuleId: string,
  incomeIds: string[],
): Promise<void> {
  await tx
    .delete(savingsRuleSalaryIncomes)
    .where(eq(savingsRuleSalaryIncomes.savingsRuleId, savingsRuleId));
  const unique = [...new Set(incomeIds)];
  if (unique.length === 0) return;
  await tx.insert(savingsRuleSalaryIncomes).values(
    unique.map((incomeId, i) => ({ savingsRuleId, incomeId, sortOrder: i })),
  );
}
