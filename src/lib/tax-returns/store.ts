import { db } from "@/db";
import { taxReturns } from "@/db/schema";
import { and, eq, lt, desc } from "drizzle-orm";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { TaxReturnRow } from "./db";

export async function listTaxReturns(clientId: string): Promise<TaxReturnRow[]> {
  return db
    .select()
    .from(taxReturns)
    .where(eq(taxReturns.clientId, clientId))
    .orderBy(desc(taxReturns.taxYear));
}

export async function getTaxReturn(clientId: string, taxYear: number): Promise<TaxReturnRow | null> {
  const [row] = await db
    .select()
    .from(taxReturns)
    .where(and(eq(taxReturns.clientId, clientId), eq(taxReturns.taxYear, taxYear)))
    .limit(1);
  return row ?? null;
}

export async function getPriorTaxReturn(clientId: string, taxYear: number): Promise<TaxReturnRow | null> {
  const [row] = await db
    .select()
    .from(taxReturns)
    .where(and(eq(taxReturns.clientId, clientId), lt(taxReturns.taxYear, taxYear)))
    .orderBy(desc(taxReturns.taxYear))
    .limit(1);
  return row ?? null;
}

export async function upsertExtracted(args: {
  clientId: string;
  taxYear: number;
  facts: TaxReturnFacts;
  warnings: string[];
  promptVersion: string;
  model: string;
  sourceFilename: string;
  vaultDocumentId: string | null;
}): Promise<TaxReturnRow> {
  const values = {
    clientId: args.clientId,
    taxYear: args.taxYear,
    status: "needs_review" as const,
    extractedFacts: args.facts,
    facts: args.facts,
    warnings: args.warnings,
    promptVersion: args.promptVersion,
    model: args.model,
    sourceFilename: args.sourceFilename,
    vaultDocumentId: args.vaultDocumentId,
  };
  const [row] = await db
    .insert(taxReturns)
    .values(values)
    .onConflictDoUpdate({
      target: [taxReturns.clientId, taxReturns.taxYear],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function updateFacts(
  clientId: string,
  taxYear: number,
  facts: TaxReturnFacts,
  markReady: boolean,
): Promise<TaxReturnRow | null> {
  const [row] = await db
    .update(taxReturns)
    .set({ facts, ...(markReady ? { status: "ready" as const } : {}), updatedAt: new Date() })
    .where(and(eq(taxReturns.clientId, clientId), eq(taxReturns.taxYear, taxYear)))
    .returning();
  return row ?? null;
}

export async function deleteTaxReturn(clientId: string, taxYear: number): Promise<boolean> {
  const rows = await db
    .delete(taxReturns)
    .where(and(eq(taxReturns.clientId, clientId), eq(taxReturns.taxYear, taxYear)))
    .returning({ id: taxReturns.id });
  return rows.length > 0;
}
