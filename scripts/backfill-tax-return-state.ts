/**
 * Turns every existing `tax_returns` row into the new derived shape: its
 * extraction becomes one `tax_return_documents` row and the advisor's
 * corrections become the sparse `tax_return_state.facts_overrides`.
 *
 * Idempotent — a return that already has a document or a state row is left
 * alone, and the state insert is `ON CONFLICT DO NOTHING`.
 *
 * SAFETY: a row is backfilled only when replaying its plan reproduces the
 * current `facts` EXACTLY (`backfillReplayDifferences`). Rows that fail that
 * gate are SKIPPED, not approximated — they get no state row, so
 * `recomputeFacts` throws `MissingTaxReturnStateError` loudly rather than
 * silently rewriting `facts`.
 *
 * The skipped bucket is NOT all data loss, so each LOSSY line is CLASSIFIED
 * rather than left for the reader to infer from a path:
 *
 *   class=entity-loss     a K-1 or Schedule C business the override layer
 *                         cannot express would be dropped. Real loss; needs an
 *                         owner decision before those returns can migrate.
 *   class=structural-only the gate refusing on shape alone, where nothing
 *                         would actually be lost — an extraction that wrote an
 *                         all-null `deductions.scheduleA` instead of omitting
 *                         it, or a `facts.taxYear` disagreeing with the column.
 *
 * The class is computed from ALL differing roots, not the first one: benign
 * `deductions.*` / `income.*` paths sort ahead of `k1s`, so a row that is both
 * would read as harmless if only the first path were consulted.
 *
 * Usage (env inline — never edit .env.local):
 *   DATABASE_URL=<url> npx tsx scripts/backfill-tax-return-state.ts
 *
 * Exit: 0 = nothing needs a human. 1 = at least one row was skipped by the
 * gate; read the class= counts before merging anything that depends on every
 * return having a state row.
 */
import { db } from "@/db";
import { taxReturns, taxReturnDocuments, taxReturnState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { taxReturnFactsSchema } from "@/lib/schemas/tax-return-facts";
import {
  planBackfill, backfillReplayDifferences, differencesIncludeEntities,
} from "@/lib/tax-returns/backfill";

async function main(): Promise<number> {
  const rows = await db.select().from(taxReturns);
  console.log(`scanning ${rows.length} tax return(s)`);
  let planned = 0, skipped = 0, corrupted = 0;
  let entityLoss = 0, structuralOnly = 0, yearMismatch = 0;

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

    const diffPaths = backfillReplayDifferences(row.taxYear, plan, parsed.data);
    if (diffPaths.length > 0) {
      const entity = differencesIncludeEntities(diffPaths);
      if (entity) entityLoss++; else structuralOnly++;
      console.warn(
        `  LOSSY   ${row.id} client=${row.clientId} year=${row.taxYear} ` +
        `class=${entity ? "entity-loss" : "structural-only"} ` +
        `diff=${diffPaths.join(",")} — replay would not reproduce facts; no state row written`,
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

    // Accepted on purpose — the replay is faithful, so the backfill preserves
    // this disagreement rather than introducing it, and the gate should not
    // change. Logged after the write (never for a row that failed to land)
    // because the app treats the state as invalid: the tax-return PUT route
    // 400s when `facts.taxYear` disagrees with the URL year, and
    // `buildTaxAnalysis` reads tax parameters from `facts.taxYear` and IRMAA
    // from `facts.taxYear + 2`. The backfill turns it into a permanent
    // override no future document can correct, so it must at least be visible.
    if (parsed.data.taxYear !== row.taxYear) {
      yearMismatch++;
      console.warn(
        `  YEARDIFF ${row.id} client=${row.clientId} column=${row.taxYear} ` +
        `facts.taxYear=${parsed.data.taxYear} — backfilled, but the year disagreement is now a ` +
        `permanent override; tax-parameter and IRMAA years read facts.taxYear`,
      );
    }
  }

  const lossy = entityLoss + structuralOnly;
  console.log(
    `backfilled=${planned} (year-mismatch=${yearMismatch}) skipped=${skipped} ` +
    `corrupted-skipped=${corrupted} lossy-skipped=${lossy} ` +
    `(entity-loss=${entityLoss} structural-only=${structuralOnly})`,
  );

  if (lossy > 0) {
    // Non-zero ONLY for the gate. `corrupted` is a genuine skip-and-continue:
    // a row whose facts never parsed already had no working recovery path and
    // this script does not change that. A LOSSY row is different — it is a
    // return this migration cannot carry forward, and someone has to decide
    // what to do about it before the pipeline can rely on state rows existing.
    console.error(
      `\n${lossy} return(s) were SKIPPED by the replay gate. Nothing was written for them and ` +
      `re-running is safe — it will report the same rows.\n` +
      `WHAT TO DO: the class= on each LOSSY line above is the answer; you do not have to read ` +
      `the paths.\n` +
      `  · class=entity-loss      (${entityLoss}) real data loss. The return holds a K-1 or ` +
      `Schedule C business the override layer cannot express; it needs an owner decision on how ` +
      `advisor-added entities are represented before it can migrate. Do NOT hand-write a state ` +
      `row. THIS is the number that sizes that decision.\n` +
      `  · class=structural-only  (${structuralOnly}) the gate refusing on shape alone, where ` +
      `nothing would actually be lost (an all-null deductions.scheduleA, or a facts.taxYear ` +
      `disagreeing with the tax_year column). Safe to revisit as a follow-up.\n` +
      `Until then these returns have no tax_return_state row, so recomputeFacts throws ` +
      `MissingTaxReturnStateError for them instead of corrupting them.`,
    );
  }
  return lossy > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
