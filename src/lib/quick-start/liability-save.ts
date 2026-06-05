// src/lib/quick-start/liability-save.ts
import { liabilityPayload, type QsContext } from "./derive";

export interface LiabilityRow {
  _id: number;
  serverId?: string;
  name: string;
  balance?: number;
  interestRatePct?: number;
  termYears?: number;
}

export interface LiabilitySaveDeps {
  ctx: QsContext;
  post: (body: unknown) => Promise<{ id: string }>;
  put: (liabilityId: string, body: unknown) => Promise<unknown>;
  del: (liabilityId: string) => Promise<unknown>;
}

/** Blank, unfilled row — don't write it. */
export function isEmptyLiability(row: LiabilityRow): boolean {
  return !row.name && row.balance == null;
}

function liabilityBody(row: LiabilityRow, ctx: QsContext) {
  return liabilityPayload(
    {
      name: row.name,
      balance: row.balance ?? 0,
      interestRate: (row.interestRatePct ?? 0) / 100,
      termYears: row.termYears,
    },
    ctx,
  );
}

/**
 * Reconcile the liabilities table against the server.
 * - delete removed-but-saved rows
 * - skip empty rows
 * - PUT rows that already have a serverId, POST the rest (capturing the new id)
 * Returns the rows with serverIds filled in so repeated saves are idempotent.
 */
export async function saveLiabilityRows(
  rows: LiabilityRow[],
  deletedServerIds: string[],
  deps: LiabilitySaveDeps,
): Promise<{ rows: LiabilityRow[] }> {
  for (const id of deletedServerIds) await deps.del(id);

  const out: LiabilityRow[] = [];
  for (const row of rows) {
    if (isEmptyLiability(row)) {
      out.push(row);
      continue;
    }
    if (row.serverId) {
      await deps.put(row.serverId, liabilityBody(row, deps.ctx));
      out.push(row);
    } else {
      const { id } = await deps.post(liabilityBody(row, deps.ctx));
      out.push({ ...row, serverId: id });
    }
  }
  return { rows: out };
}
