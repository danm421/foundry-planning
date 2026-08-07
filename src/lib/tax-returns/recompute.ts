import { db } from "@/db";
import { taxReturns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { taxReturnFactsSchema, type TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { MissingTaxReturnStateError, EmptyRecomputeError } from "./errors";
import { mergeDocuments } from "./merge/merge-documents";
import { applyOverrides } from "./merge/overrides";
import { deriveProvenance } from "./merge/provenance";
import type { FieldConflict, DroppedValue, MergeDocument, OverrideMap } from "./merge/types";
import { listDocuments, rowToMergeDocument, getState } from "./documents-store";

export interface AssembledFacts {
  facts: TaxReturnFacts;
  provenance: Record<string, string>;
  conflicts: FieldConflict[];
  dropped: DroppedValue[];
}

/** Pure: documents + overrides → the working facts. The single definition of
 *  what `tax_returns.facts` MEANS. */
export function assembleFacts(
  taxYear: number,
  docs: MergeDocument[],
  overrides: OverrideMap,
): AssembledFacts {
  const merged = mergeDocuments(taxYear, docs);
  return {
    facts: applyOverrides(merged.facts, overrides),
    provenance: deriveProvenance(merged.provenance, overrides),
    conflicts: merged.conflicts,
    dropped: merged.dropped,
  };
}

export { MissingTaxReturnStateError, EmptyRecomputeError } from "./errors";

/**
 * The SINGLE writer of `tax_returns.facts`. Called on document add, document
 * remove, and review-form save.
 *
 * Refuses in two situations rather than writing something destructive:
 *  - no state row (see `MissingTaxReturnStateError`) — an un-backfilled row
 *    still carries the advisor's corrections in `facts`, and recomputing it
 *    against `{}` would silently discard them;
 *  - nothing to derive from at all (see `EmptyRecomputeError`) — zero documents
 *    AND zero overrides merges to all-nulls, which would blank a filed return.
 *
 * The assembled facts are re-validated before they are persisted. `facts` is
 * re-parsed by `parseRowFacts` on EVERY read, so persisting a value that does
 * not satisfy the schema does not fail here — it blanks the client's whole Tax
 * Analysis tab on every subsequent read, permanently. Overrides are the one
 * input to this function that is never schema-checked (`facts_overrides` is
 * bare jsonb, and `applyOverrides` type-checks nothing), so this is the only
 * place that can catch it.
 */
export async function recomputeFacts(taxReturnId: string, taxYear: number): Promise<TaxReturnFacts> {
  const [docs, state] = await Promise.all([
    listDocuments(taxReturnId),
    getState(taxReturnId),
  ]);
  if (!state) throw new MissingTaxReturnStateError(taxReturnId);

  const overrides = state.factsOverrides ?? {};
  if (docs.length === 0 && Object.keys(overrides).length === 0) {
    throw new EmptyRecomputeError(taxReturnId);
  }

  const assembled = assembleFacts(taxYear, docs.map(rowToMergeDocument), overrides);
  const facts = taxReturnFactsSchema.parse(assembled.facts);

  await db
    .update(taxReturns)
    .set({ facts, updatedAt: new Date() })
    .where(eq(taxReturns.id, taxReturnId));

  return facts;
}
