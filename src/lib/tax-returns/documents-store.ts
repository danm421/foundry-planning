import { db } from "@/db";
import { taxReturnDocuments, taxReturnState } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { taxReturnFactsSchema } from "@/lib/schemas/tax-return-facts";
import type { MergeDocument, OverrideMap } from "./merge/types";

export type TaxReturnDocumentRow = typeof taxReturnDocuments.$inferSelect;

/** Ordered OLDEST FIRST — mergeDocuments treats array order as write order. */
export async function listDocuments(taxReturnId: string): Promise<TaxReturnDocumentRow[]> {
  return db
    .select()
    .from(taxReturnDocuments)
    .where(eq(taxReturnDocuments.taxReturnId, taxReturnId))
    .orderBy(asc(taxReturnDocuments.createdAt));
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

export async function deleteDocument(id: string): Promise<TaxReturnDocumentRow | null> {
  const [row] = await db
    .delete(taxReturnDocuments)
    .where(eq(taxReturnDocuments.id, id))
    .returning();
  return row ?? null;
}

export async function getState(taxReturnId: string) {
  const [row] = await db
    .select()
    .from(taxReturnState)
    .where(eq(taxReturnState.taxReturnId, taxReturnId))
    .limit(1);
  return row ?? null;
}

export async function putOverrides(taxReturnId: string, overrides: OverrideMap): Promise<void> {
  await db
    .insert(taxReturnState)
    .values({ taxReturnId, factsOverrides: overrides })
    .onConflictDoUpdate({
      target: taxReturnState.taxReturnId,
      set: { factsOverrides: overrides, updatedAt: new Date() },
    });
}
