/**
 * Turns every existing `tax_returns` row into the new derived shape: its
 * extraction becomes one `tax_return_documents` row and the advisor's
 * corrections become the sparse `tax_return_state.facts_overrides`.
 *
 * Idempotent — a return that already has a document or a state row is left
 * alone, and the state insert is `ON CONFLICT DO NOTHING`.
 *
 * SAFETY: a row is backfilled only when replaying its plan reproduces the
 * current `facts` EXACTLY (`backfillPlanReplaysFacts`). Rows that fail that
 * gate — today, ones carrying a K-1 or Schedule C business the document layer
 * cannot reproduce — are SKIPPED, not approximated. A skipped row has no
 * state row, so `recomputeFacts` throws `MissingTaxReturnStateError` loudly
 * rather than silently rewriting `facts` with those entities deleted.
 *
 * Usage (env inline — never edit .env.local):
 *   DATABASE_URL=<url> npx tsx scripts/backfill-tax-return-state.ts
 */
import { db } from "@/db";
import { taxReturns, taxReturnDocuments, taxReturnState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { taxReturnFactsSchema } from "@/lib/schemas/tax-return-facts";
import { planBackfill, backfillPlanReplaysFacts } from "@/lib/tax-returns/backfill";

async function main() {
  const rows = await db.select().from(taxReturns);
  console.log(`scanning ${rows.length} tax return(s)`);
  let planned = 0, skipped = 0, corrupted = 0, lossy = 0;

  for (const row of rows) {
    const existing = await db
      .select({ id: taxReturnDocuments.id })
      .from(taxReturnDocuments)
      .where(eq(taxReturnDocuments.taxReturnId, row.id))
      .limit(1);
    const hasState = await db
      .select({ id: taxReturnState.taxReturnId })
      .from(taxReturnState)
      .where(eq(taxReturnState.taxReturnId, row.id))
      .limit(1);
    if (existing.length > 0 || hasState.length > 0) { skipped++; continue; }

    // `planBackfill` returns null on exactly this parse failure. Parsing here
    // too is what gives the gate below the canonical schema-parsed facts to
    // compare against — the same value `parseRowFacts` yields on every read.
    const parsed = taxReturnFactsSchema.safeParse(row.facts);
    const plan = planBackfill({
      id: row.id, taxYear: row.taxYear,
      extractedFacts: row.extractedFacts, facts: row.facts,
      sourceFilename: row.sourceFilename, vaultDocumentId: row.vaultDocumentId,
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
      promptVersion: row.promptVersion, model: row.model,
    });
    if (!parsed.success || !plan) {
      corrupted++;
      console.warn(`  CORRUPT ${row.id} client=${row.clientId} year=${row.taxYear} — facts do not parse; no state row written`);
      continue;
    }

    if (!backfillPlanReplaysFacts(row.taxYear, plan, parsed.data)) {
      lossy++;
      console.warn(
        `  LOSSY   ${row.id} client=${row.clientId} year=${row.taxYear} ` +
        `businesses=${parsed.data.businesses.length} k1s=${parsed.data.k1s.length} ` +
        `— replay would not reproduce facts; no state row written`,
      );
      continue;
    }

    await db.transaction(async (tx) => {
      if (plan.document) {
        await tx.insert(taxReturnDocuments).values({
          taxReturnId: plan.taxReturnId, ...plan.document,
          supportingPayload: null,
        });
      }
      await tx.insert(taxReturnState)
        .values({ taxReturnId: plan.taxReturnId, factsOverrides: plan.overrides })
        .onConflictDoNothing();
    });
    planned++;
  }

  console.log(
    `backfilled=${planned} skipped=${skipped} corrupted-skipped=${corrupted} lossy-skipped=${lossy}`,
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
