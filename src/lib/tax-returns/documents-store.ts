import { db } from "@/db";
import { taxReturnDocuments, taxReturnState } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { taxReturnFactsSchema } from "@/lib/schemas/tax-return-facts";
import { MissingTaxReturnStateError } from "./errors";
import type { MergeDocument, OverrideMap } from "./merge/types";

export type TaxReturnDocumentRow = typeof taxReturnDocuments.$inferSelect;

/**
 * Ordered OLDEST FIRST — mergeDocuments treats array order as write order.
 *
 * `created_at` is `DEFAULT now()`, which is transaction start time, so two
 * documents inserted in the same transaction can share an identical
 * timestamp and Postgres may return them in either order. The secondary sort
 * on `id` only makes that tie STABLE across queries — the same two rows come
 * back in the same relative order every time — it does not recover a true
 * write order between them. Genuinely fixing that needs a monotonic sequence
 * column (e.g. `bigserial`), which is a migration; out of scope here.
 */
export async function listDocuments(taxReturnId: string): Promise<TaxReturnDocumentRow[]> {
  return db
    .select()
    .from(taxReturnDocuments)
    .where(eq(taxReturnDocuments.taxReturnId, taxReturnId))
    .orderBy(asc(taxReturnDocuments.createdAt), asc(taxReturnDocuments.id));
}

/** A document whose stored facts no longer satisfy the schema contributes
 *  nothing rather than failing the whole year — same posture as parseRowFacts. */
export function rowToMergeDocument(row: TaxReturnDocumentRow): MergeDocument {
  const parsed = row.extractedFacts ? taxReturnFactsSchema.safeParse(row.extractedFacts) : null;
  return {
    id: row.id,
    role: row.role,
    taxYear: row.taxYear,
    facts: parsed?.success ? parsed.data : null,
  };
}

export async function insertDocument(args: {
  taxReturnId: string;
  role: TaxReturnDocumentRow["role"];
  filename: string | null;
  vaultDocumentId: string | null;
  extractedFacts: unknown;
  supportingPayload: unknown;
  warnings: string[];
  promptVersion: string | null;
  model: string | null;
  taxYear: number;
}): Promise<TaxReturnDocumentRow> {
  const [row] = await db.insert(taxReturnDocuments).values(args).returning();
  return row;
}

/** Scoped to `taxReturnId` so a request authz'd for one tax return can never
 *  delete another one's document row — the route can't pre-check ownership
 *  itself because the row only comes back after the delete. */
export async function deleteDocument(
  taxReturnId: string,
  id: string,
): Promise<TaxReturnDocumentRow | null> {
  const [row] = await db
    .delete(taxReturnDocuments)
    .where(and(eq(taxReturnDocuments.taxReturnId, taxReturnId), eq(taxReturnDocuments.id, id)))
    .returning();
  return row ?? null;
}

export type TaxReturnStateRow = typeof taxReturnState.$inferSelect;

export async function getState(taxReturnId: string): Promise<TaxReturnStateRow | null> {
  const [row] = await db
    .select()
    .from(taxReturnState)
    .where(eq(taxReturnState.taxReturnId, taxReturnId))
    .limit(1);
  return row ?? null;
}

/**
 * UPDATE-only. Throws `MissingTaxReturnStateError` when no state row exists,
 * rather than creating one. That distinction is load-bearing, not stylistic.
 *
 * NOTHING in the request path may CREATE a state row. `recomputeFacts`'
 * `MissingTaxReturnStateError` guard exists to stop a row the backfill has not
 * converted (or deliberately refused) from being recomputed — and a recompute
 * of such a row merges only its documents over `tax_returns.facts`, blanking
 * every figure the documents do not restate. Any code that creates the row
 * first disarms that guard one call earlier, so the very next line destroys
 * data. Ordering the deploy cannot fix it: rows the backfill skips get no
 * state row BY DESIGN, and the legacy `tax_returns` writers (`upsertExtracted`)
 * keep minting rows without one indefinitely.
 *
 * So the ONLY writer that may create a state row is the backfill script, which
 * does it inside the same transaction as the document insert after its replay
 * gate has passed. `saveReviewedFacts` takes the legacy path when there is no
 * state row, and `addDocumentToReturn` refuses outright.
 *
 * `updatedAt` is set explicitly: the column has `.defaultNow()` but no
 * `$onUpdate`, so it does not advance by itself.
 */
export async function putOverrides(taxReturnId: string, overrides: OverrideMap): Promise<void> {
  const updated = await db
    .update(taxReturnState)
    .set({ factsOverrides: overrides, updatedAt: new Date() })
    .where(eq(taxReturnState.taxReturnId, taxReturnId))
    .returning({ taxReturnId: taxReturnState.taxReturnId });
  if (updated.length === 0) throw new MissingTaxReturnStateError(taxReturnId);
}
