import { db } from "@/db";
import { taxReturnDocuments, taxReturnState } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { recomputeFacts } from "./recompute";

/**
 * Make a freshly extracted 1040 the return's `full_return` DOCUMENT, not just a
 * blob on `tax_returns.facts`.
 *
 * WHY THIS EXISTS. `upsertExtracted` writes `tax_returns` directly and creates
 * neither a document nor a state row, so without this the upload path keeps
 * minting returns the documents pipeline cannot touch — `addDocumentToReturn`
 * refuses them (it cannot create a state row without destroying the facts that
 * row already holds), so the documents feature would be permanently unreachable
 * for every return an advisor actually creates, not merely until the backfill
 * runs.
 *
 * WHY IT IS SAFE TO CREATE THE STATE ROW HERE, when nothing else in a request
 * path may. The rule the rest of this module obeys is not "never create a state
 * row" — it is "never create one without simultaneously representing the
 * return's existing facts as documents", because a state row alone disarms
 * `recomputeFacts`' `MissingTaxReturnStateError` guard and the next recompute
 * then merges over facts nothing can reproduce. This function satisfies that
 * rule BY CONSTRUCTION: the state row and the document that carries those exact
 * facts are written in ONE transaction, so no interleaving can leave the state
 * row standing alone. It is the same shape the backfill script uses.
 *
 * RE-UPLOAD (`replace=true`) replaces the `full_return` document rather than
 * appending one. Two full-return documents would make every scalar the corrected
 * copy restates read as a CONFLICT against its own superseded predecessor.
 * Supporting documents (K-1s, W-2s) and the advisor's overrides deliberately
 * SURVIVE — re-uploading a corrected 1040 must not silently discard the K-1s
 * that were merged into the year or the corrections already made on top.
 *
 * The recompute is deliberately OUTSIDE the transaction: it is the single writer
 * of `tax_returns.facts` (D3) and re-reads the documents it just committed. If
 * it throws, the caller's `upsertExtracted` value stays on `facts` — which is
 * this same extraction, so the row is consistent either way.
 */
export async function adoptExtractedReturn(args: {
  taxReturnId: string;
  taxYear: number;
  facts: TaxReturnFacts;
  warnings: string[];
  promptVersion: string;
  model: string;
  filename: string;
  vaultDocumentId: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(taxReturnState)
      .values({ taxReturnId: args.taxReturnId, factsOverrides: {} })
      .onConflictDoNothing();

    await tx
      .delete(taxReturnDocuments)
      .where(
        and(
          eq(taxReturnDocuments.taxReturnId, args.taxReturnId),
          eq(taxReturnDocuments.role, "full_return"),
        ),
      );

    await tx.insert(taxReturnDocuments).values({
      taxReturnId: args.taxReturnId,
      role: "full_return",
      filename: args.filename,
      vaultDocumentId: args.vaultDocumentId,
      extractedFacts: args.facts,
      supportingPayload: null,
      warnings: args.warnings,
      promptVersion: args.promptVersion,
      model: args.model,
      taxYear: args.taxYear,
    });
  });

  await recomputeFacts(args.taxReturnId, args.taxYear);
}

/**
 * Give a manually-entered return its state row so it can accept documents and
 * carry overrides.
 *
 * No document is created, and none is missing: `upsertExtracted` has just
 * written `emptyTaxReturnFacts` for this year, so there are no facts for a
 * document to represent and nothing a later recompute could blank. That is the
 * same shape `planBackfill` produces for a hand-entered row (`document: null`,
 * facts carried entirely as overrides), so the two creation paths agree.
 *
 * Existing documents are deliberately left alone. Replacing an extracted year
 * with manual entry already blanks `facts` by design; keeping the documents
 * means a later recompute restores what they say rather than leaving the year
 * empty.
 */
export async function adoptManualReturn(taxReturnId: string): Promise<void> {
  await db
    .insert(taxReturnState)
    .values({ taxReturnId, factsOverrides: {} })
    .onConflictDoNothing();
}
