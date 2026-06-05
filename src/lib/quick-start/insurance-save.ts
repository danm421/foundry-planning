// src/lib/quick-start/insurance-save.ts
import { insurancePayload, type QsContext } from "./derive";
import type { QsInsuranceDraft } from "./types";

export type InsuranceRow = QsInsuranceDraft & { _id: number; serverId?: string };

export interface InsuranceSaveDeps {
  ctx: QsContext;
  familyMemberIdFor: (insured: "client" | "spouse") => string | null;
  post: (body: unknown) => Promise<{ id: string }>;
  patch: (policyId: string, body: unknown) => Promise<unknown>;
  del: (policyId: string) => Promise<unknown>;
}

/** A row with no face value entered yet shouldn't be written. */
export function isEmptyInsurance(draft: QsInsuranceDraft): boolean {
  return !draft.faceValue;
}

/**
 * Reconcile the insurance table against the server on Next.
 * - delete removed-but-saved rows
 * - skip empty (faceValue 0) rows
 * - PATCH rows that already have a serverId, POST the rest (capturing the new id)
 * Returns the rows with serverIds filled in so repeated saves are idempotent.
 */
export async function saveInsuranceRows(
  rows: InsuranceRow[],
  deletedServerIds: string[],
  deps: InsuranceSaveDeps,
): Promise<{ rows: InsuranceRow[] }> {
  for (const id of deletedServerIds) await deps.del(id);

  const out: InsuranceRow[] = [];
  for (const row of rows) {
    const { _id, serverId, ...draft } = row;
    void _id;
    if (isEmptyInsurance(draft)) {
      out.push(row);
      continue;
    }
    const body = insurancePayload(draft, deps.ctx, deps.familyMemberIdFor(draft.insured));
    if (serverId) {
      await deps.patch(serverId, body);
      out.push(row);
    } else {
      const { id } = await deps.post(body);
      out.push({ ...row, serverId: id });
    }
  }
  return { rows: out };
}
