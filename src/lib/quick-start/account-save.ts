// src/lib/quick-start/account-save.ts
import { accountPayload, type QsContext } from "./derive";
import type { QsAccountDraft } from "./types";

export type AccountRow = QsAccountDraft & { _id: number; serverId?: string };

export interface AccountSaveDeps {
  ctx: QsContext;
  post: (body: unknown) => Promise<{ id: string }>;
  put: (accountId: string, body: unknown) => Promise<unknown>;
  del: (accountId: string) => Promise<unknown>;
}

/** A row with no value entered yet shouldn't be written. */
export function isEmptyAccount(draft: QsAccountDraft): boolean {
  return !draft.value; // 0 or undefined => empty
}

/**
 * Reconcile the accounts table against the server on Next.
 * - delete removed-but-saved rows
 * - skip empty rows
 * - PUT rows that already have a serverId, POST the rest (capturing the new id)
 * Returns the rows with serverIds filled in so repeated saves are idempotent.
 */
export async function saveAccountRows(
  rows: AccountRow[],
  deletedServerIds: string[],
  deps: AccountSaveDeps,
): Promise<{ rows: AccountRow[] }> {
  for (const id of deletedServerIds) await deps.del(id);

  const out: AccountRow[] = [];
  for (const row of rows) {
    const { _id, serverId, ...draft } = row;
    void _id;
    if (isEmptyAccount(draft)) {
      out.push(row);
      continue;
    }
    if (serverId) {
      await deps.put(serverId, accountPayload(draft, deps.ctx));
      out.push(row);
    } else {
      const { id } = await deps.post(accountPayload(draft, deps.ctx));
      out.push({ ...row, serverId: id });
    }
  }
  return { rows: out };
}
