import { db } from "@/db";
import { taxReturns } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
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

export class MissingTaxReturnStateError extends Error {
  constructor(taxReturnId: string) {
    super(`tax_return_state row missing for ${taxReturnId} — backfill has not run`);
    this.name = "MissingTaxReturnStateError";
  }
}

/**
 * The SINGLE writer of `tax_returns.facts`. Called on document add, document
 * remove, and review-form save.
 *
 * Throws when no state row exists rather than assuming empty overrides: an
 * un-backfilled row still carries the advisor's corrections in `facts`, and
 * recomputing it against `{}` would silently discard them. Failing loudly is
 * the whole point.
 */
export async function recomputeFacts(taxReturnId: string, taxYear: number): Promise<TaxReturnFacts> {
  const [docs, state] = await Promise.all([
    listDocuments(taxReturnId),
    getState(taxReturnId),
  ]);
  if (!state) throw new MissingTaxReturnStateError(taxReturnId);

  const assembled = assembleFacts(
    taxYear,
    docs.map(rowToMergeDocument),
    state.factsOverrides ?? {},
  );

  await db
    .update(taxReturns)
    .set({ facts: assembled.facts, updatedAt: new Date() })
    .where(eq(taxReturns.id, taxReturnId));

  return assembled.facts;
}
