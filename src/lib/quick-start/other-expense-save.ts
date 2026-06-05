// src/lib/quick-start/other-expense-save.ts
import { otherExpensePayload, type QsContext } from "./derive";

export interface OtherExpenseRow {
  _id: number;
  serverId?: string;
  name: string;
  amount?: number;
}

export interface OtherExpenseSaveDeps {
  ctx: QsContext;
  post: (body: unknown) => Promise<{ id: string }>;
  put: (expenseId: string, body: unknown) => Promise<unknown>;
  del: (expenseId: string) => Promise<unknown>;
}

/** Blank, unfilled row — don't write it. */
export function isEmptyOtherExpense(row: OtherExpenseRow): boolean {
  return !row.name && row.amount == null;
}

function otherExpenseBody(row: OtherExpenseRow, ctx: QsContext) {
  return otherExpensePayload({ name: row.name, amount: row.amount ?? 0 }, ctx);
}

/**
 * Reconcile the other-expenses table against the server.
 * - delete removed-but-saved rows
 * - skip empty rows
 * - PUT rows that already have a serverId, POST the rest (capturing the new id)
 * Returns the rows with serverIds filled in so repeated saves are idempotent.
 */
export async function saveOtherExpenseRows(
  rows: OtherExpenseRow[],
  deletedServerIds: string[],
  deps: OtherExpenseSaveDeps,
): Promise<{ rows: OtherExpenseRow[] }> {
  for (const id of deletedServerIds) await deps.del(id);

  const out: OtherExpenseRow[] = [];
  for (const row of rows) {
    if (isEmptyOtherExpense(row)) {
      out.push(row);
      continue;
    }
    if (row.serverId) {
      await deps.put(row.serverId, otherExpenseBody(row, deps.ctx));
      out.push(row);
    } else {
      const { id } = await deps.post(otherExpenseBody(row, deps.ctx));
      out.push({ ...row, serverId: id });
    }
  }
  return { rows: out };
}
