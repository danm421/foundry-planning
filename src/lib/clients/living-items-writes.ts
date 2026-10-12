// src/lib/clients/living-items-writes.ts
//
// Puts a typed list of items on the base case's Current Living Expenses row —
// the one row an advisor can itemize (`isItemizableLivingRow`). The Forge calls
// this with a list; the merged items go through updateExpenseForClient, so the
// access check, validation, the items-set-the-total rule and the expense.update
// audit apply exactly as they do on the page.
import { db } from "@/db";
import { expenses, scenarios } from "@/db/schema";
import { and, eq, getTableColumns } from "drizzle-orm";
import { isItemizableLivingRow } from "@/lib/living-slot-order";
import { mergeLivingItems, type LivingItemInput } from "@/lib/living-expense-items";
import { updateExpenseForClient } from "./expenses-writes";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type ExpenseRow = typeof expenses.$inferSelect;

export const NO_CURRENT_LIVING_ROW =
  "This plan has no Current Living Expenses row to itemize.";

/** The base case's Current Living Expenses row, or null. Not an access check:
 *  callers gate first, and the write re-checks. */
export async function findCurrentLivingExpense(clientId: string): Promise<ExpenseRow | null> {
  const rows = await db
    .select(getTableColumns(expenses))
    .from(expenses)
    .innerJoin(scenarios, eq(scenarios.id, expenses.scenarioId))
    .where(
      and(
        eq(expenses.clientId, clientId),
        eq(scenarios.isBaseCase, true),
        eq(expenses.type, "living"),
      ),
    );
  return rows.find(isItemizableLivingRow) ?? null;
}

export async function setLivingItemsForClient(args: {
  clientId: string;
  firmId: string;
  actorId: string;
  items: LivingItemInput[];
  mode: "add" | "replace";
}): Promise<EntityWriteResult<ExpenseRow>> {
  const { clientId, firmId, actorId, items, mode } = args;

  const row = await findCurrentLivingExpense(clientId);
  if (!row) return writeError(404, NO_CURRENT_LIVING_ROW);

  const livingItems = mergeLivingItems(row.livingItems ?? [], items, mode, () =>
    crypto.randomUUID(),
  );
  return updateExpenseForClient({
    clientId,
    firmId,
    actorId,
    expenseId: row.id,
    input: { livingItems },
  });
}
