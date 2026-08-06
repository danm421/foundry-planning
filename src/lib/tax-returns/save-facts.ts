import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { listDocuments, getState, putOverrides, rowToMergeDocument } from "./documents-store";
import { mergeDocuments } from "./merge/merge-documents";
import { diffOverrides } from "./merge/overrides";
import { recomputeFacts } from "./recompute";
import { getTaxReturn, updateFacts, setStatus } from "./store";

/**
 * The review form still PUTs a whole facts object, as it always has. This turns
 * that into the sparse override layer: diff the submission against what the
 * DOCUMENTS alone merge to, and persist only the differing paths.
 *
 * The form does not need to know overrides exist. A field the advisor never
 * touched stays document-sourced and keeps tracking its document if that
 * document is later re-extracted.
 *
 * A return with NO state row takes the legacy path unchanged. That is not
 * convenience: `MissingTaxReturnStateError` exists so a row the backfill
 * deliberately refused is never recomputed against an empty override map,
 * which would discard the advisor's corrections wholesale. Creating the state
 * row here would disarm that guard one call earlier.
 */
export async function saveReviewedFacts(args: {
  clientId: string;
  taxYear: number;
  submitted: TaxReturnFacts;
  nextStatus?: "ready" | "needs_review";
}): Promise<{ taxYear: number; status: string } | null> {
  const row = await getTaxReturn(args.clientId, args.taxYear);
  if (!row) return null;

  const state = await getState(row.id);
  if (!state) {
    const updated = await updateFacts(args.clientId, args.taxYear, args.submitted, args.nextStatus);
    return updated ? { taxYear: updated.taxYear, status: updated.status } : null;
  }

  const docs = await listDocuments(row.id);
  const base = mergeDocuments(args.taxYear, docs.map(rowToMergeDocument)).facts;
  await putOverrides(row.id, diffOverrides(base, args.submitted));
  await recomputeFacts(row.id, args.taxYear);

  if (args.nextStatus) {
    const updated = await setStatus(args.clientId, args.taxYear, args.nextStatus);
    return updated ? { taxYear: updated.taxYear, status: updated.status } : null;
  }
  return { taxYear: row.taxYear, status: row.status };
}
