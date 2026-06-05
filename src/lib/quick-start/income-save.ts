// src/lib/quick-start/income-save.ts
import { incomePayload, ssPatch, type QsContext } from "./derive";
import type { QsIncomeDraft } from "./types";

export type IncomeRow = QsIncomeDraft & { _id: number; serverId?: string };

export interface IncomeSaveDeps {
  clientId: string;
  ctx: QsContext;
  post: (body: unknown) => Promise<{ id: string }>;
  put: (incomeId: string, body: unknown) => Promise<unknown>;
  del: (incomeId: string) => Promise<unknown>;
}

/** A row carries no real data yet, so it shouldn't be written. */
export function isEmptyIncome(draft: QsIncomeDraft): boolean {
  if (draft.kind === "social_security") return !draft.monthlyBenefit;
  return draft.amount == null || Number.isNaN(draft.amount);
}

/**
 * Reconcile the income table against the server on Next.
 * - delete removed-but-saved rows
 * - skip empty rows
 * - PUT rows that already have a serverId, POST the rest (capturing the new id)
 * Returns the rows with serverIds filled in so repeated saves are idempotent.
 */
export async function saveIncomeRows(
  rows: IncomeRow[],
  deletedServerIds: string[],
  deps: IncomeSaveDeps,
): Promise<{ rows: IncomeRow[] }> {
  for (const id of deletedServerIds) await deps.del(id);

  const out: IncomeRow[] = [];
  for (const row of rows) {
    const { _id, serverId, ...draft } = row;
    void _id;
    if (isEmptyIncome(draft)) {
      out.push(row);
      continue;
    }
    if (draft.kind === "social_security") {
      if (serverId) {
        await deps.put(
          serverId,
          ssPatch({ monthlyBenefit: draft.monthlyBenefit, claimingAge: draft.claimingAge }),
        );
        out.push(row);
      } else {
        const { id } = await deps.post(incomePayload(draft, deps.ctx));
        out.push({ ...row, serverId: id });
      }
    } else if (serverId) {
      await deps.put(serverId, incomePayload(draft, deps.ctx));
      out.push(row);
    } else {
      const { id } = await deps.post(incomePayload(draft, deps.ctx));
      out.push({ ...row, serverId: id });
    }
  }
  return { rows: out };
}
