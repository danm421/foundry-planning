/**
 * Errors shared by the facts-derivation layer.
 *
 * These live here rather than in `recompute.ts` so `documents-store.ts` can
 * throw them without importing `recompute.ts`, which imports it back.
 */

/** Thrown when a tax return has no `tax_return_state` row. Both the writer and
 *  the override store fail loudly on this rather than assuming empty overrides:
 *  an un-backfilled row still carries the advisor's corrections in `facts`, and
 *  treating its overrides as `{}` would silently discard them. */
export class MissingTaxReturnStateError extends Error {
  constructor(taxReturnId: string) {
    super(`tax_return_state row missing for ${taxReturnId} — backfill has not run`);
    this.name = "MissingTaxReturnStateError";
  }
}

/** Thrown when a recompute would derive facts from nothing at all.
 *
 *  `mergeDocuments(year, [])` returns `emptyTaxReturnFacts(year)` — every leaf
 *  null, both entity collections empty — so with no documents AND no overrides
 *  a recompute would overwrite a filed return with blanks. That is what
 *  removing the last document from a backfilled return looks like, and on a row
 *  whose `facts` equalled its `extracted_facts` (the whole of production today)
 *  it would erase every value the client filed.
 *
 *  Removing the last document is a DELETE-THE-RETURN operation, not a recompute;
 *  refusing here keeps that decision with the caller instead of silently
 *  destroying data. */
export class EmptyRecomputeError extends Error {
  constructor(taxReturnId: string) {
    super(
      `refusing to recompute ${taxReturnId} from zero documents and zero overrides — ` +
        `this would blank tax_returns.facts. Delete the return instead.`,
    );
    this.name = "EmptyRecomputeError";
  }
}
