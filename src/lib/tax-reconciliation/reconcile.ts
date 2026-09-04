import { buildReconciliation } from "./build";
import { loadReconciliationInput, type LoadFailure } from "./load-input";
import type { Reconciliation } from "./types";

export type ComputeResult = { ok: true; taxReturnId: string; reconciliation: Reconciliation } | LoadFailure;

/** One projection per call, like the estate-planning page. No limiter. */
export async function computeReconciliation(clientId: string, firmId: string, taxYear: number): Promise<ComputeResult> {
  const loaded = await loadReconciliationInput(clientId, firmId, taxYear);
  if (!loaded.ok) return loaded;
  const reconciliation = buildReconciliation(loaded.input, {
    status: loaded.status, dismissedIds: loaded.dismissedIds, dismissalsUnavailable: loaded.dismissalsUnavailable, notes: loaded.notes,
  });
  return { ok: true, taxReturnId: loaded.taxReturnId, reconciliation };
}
