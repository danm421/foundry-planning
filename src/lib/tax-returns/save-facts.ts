import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { listDocuments, getState, putOverrides, rowToMergeDocument } from "./documents-store";
import { mergeDocuments, contributesToMerge } from "./merge/merge-documents";
import { diffOverrides } from "./merge/overrides";
import { EmptyRecomputeError } from "./errors";
import { isUndefinedTable } from "./pg-errors";
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
 * row here would disarm that guard one call earlier. A `getState` that fails
 * with Postgres `undefined_table` (migration `0233` not applied yet) takes
 * the same legacy path: if the tables don't exist, no state row and no
 * overrides exist anywhere, so the direct write loses nothing — same
 * degrade-not-500 posture as `assemble-analysis.ts`'s read path.
 *
 * `putOverrides` commits immediately, before `recomputeFacts` gets a chance
 * to refuse — so the empty-derivation guard `recomputeFacts` already applies
 * is checked here too, BEFORE the write, not just inside it. Without this, a
 * document-less return (every manually-entered/backfilled row with no
 * documents at all: `planBackfill`'s `document: null` case) whose advisor
 * clears every field would diff to `{}`, `putOverrides` would commit that
 * over the overrides holding its only data, and only then would
 * `recomputeFacts` refuse — too late, the data is already gone.
 */
export async function saveReviewedFacts(args: {
  clientId: string;
  taxYear: number;
  submitted: TaxReturnFacts;
  nextStatus?: "ready" | "needs_review";
}): Promise<{ taxYear: number; status: string } | null> {
  const row = await getTaxReturn(args.clientId, args.taxYear);
  if (!row) return null;

  let state;
  try {
    state = await getState(row.id);
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
    state = null;
  }
  if (!state) {
    const updated = await updateFacts(args.clientId, args.taxYear, args.submitted, args.nextStatus);
    return updated ? { taxYear: updated.taxYear, status: updated.status } : null;
  }

  const docs = await listDocuments(row.id);
  const mergeDocs = docs.map(rowToMergeDocument);
  const base = mergeDocuments(args.taxYear, mergeDocs).facts;
  const overrides = diffOverrides(base, args.submitted);
  // Mirrors `recomputeFacts`: CONTRIBUTING documents, not rows. A year holding
  // only a W-2 has data in `facts` and nothing that can rebuild it, so an
  // advisor clearing the form must be refused here — before `putOverrides`
  // commits — exactly as it is for a year holding no documents at all.
  if (!mergeDocs.some(contributesToMerge) && Object.keys(overrides).length === 0) {
    throw new EmptyRecomputeError(row.id);
  }

  await putOverrides(row.id, overrides);
  await recomputeFacts(row.id, args.taxYear);

  if (args.nextStatus) {
    const updated = await setStatus(args.clientId, args.taxYear, args.nextStatus);
    return updated ? { taxYear: updated.taxYear, status: updated.status } : null;
  }
  return { taxYear: row.taxYear, status: row.status };
}
