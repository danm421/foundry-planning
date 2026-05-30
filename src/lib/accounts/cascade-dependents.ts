import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { transfers, rothConversions } from "@/db/schema";

export type AccountCascadeDependent = { id: string; name: string };

export type AccountCascadeDependents = {
  transfers: AccountCascadeDependent[];
  rothConversions: AccountCascadeDependent[];
};

/**
 * Lists the transfers and Roth conversions that reference `accountId` and would
 * be silently cascade-deleted along with the account (audit F15:
 * transfers.source/target_account_id and roth_conversions.destination_account_id
 * are ON DELETE CASCADE). Powers the pre-delete warning so the advisor sees what
 * multi-year intent they're about to lose.
 *
 * clientId-scoped: a row belonging to another client is never returned even if
 * it shares the account id, so this can't leak (or imply deletion of) cross-firm
 * data.
 */
export async function listAccountCascadeDependents(
  clientId: string,
  accountId: string,
): Promise<AccountCascadeDependents> {
  // Two independent reads — run them concurrently.
  const [transferRows, rothRows] = await Promise.all([
    db
      .select({ id: transfers.id, name: transfers.name })
      .from(transfers)
      .where(
        and(
          eq(transfers.clientId, clientId),
          or(
            eq(transfers.sourceAccountId, accountId),
            eq(transfers.targetAccountId, accountId),
          ),
        ),
      ),
    db
      .select({ id: rothConversions.id, name: rothConversions.name })
      .from(rothConversions)
      .where(
        and(
          eq(rothConversions.clientId, clientId),
          eq(rothConversions.destinationAccountId, accountId),
        ),
      ),
  ]);

  return {
    transfers: transferRows.map((r) => ({ id: r.id, name: r.name })),
    rothConversions: rothRows.map((r) => ({ id: r.id, name: r.name })),
  };
}
