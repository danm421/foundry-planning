import { isDeepStrictEqual } from "node:util";
import {
  emptyTaxReturnFacts,
  taxReturnFactsSchema,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import { diffOverrides } from "./merge/overrides";
import type { MergeDocument, OverrideMap } from "./merge/types";
import { assembleFacts } from "./recompute";

export interface BackfillSourceRow {
  id: string;
  taxYear: number;
  extractedFacts: unknown;
  facts: unknown;
  sourceFilename: string | null;
  vaultDocumentId: string | null;
  warnings: string[];
  promptVersion: string | null;
  model: string | null;
}

export interface BackfillPlan {
  taxReturnId: string;
  document: {
    role: "full_return";
    filename: string | null;
    vaultDocumentId: string | null;
    extractedFacts: TaxReturnFacts;
    warnings: string[];
    promptVersion: string | null;
    model: string | null;
    taxYear: number;
  } | null;
  overrides: OverrideMap;
}

/**
 * Pure plan for one existing row: the row's extraction becomes its one
 * document and the advisor's corrections become sparse overrides.
 *
 * A manually-entered row has no extraction, so it gets no document and its
 * whole hand-entered facts become overrides.
 *
 * This plan is a PROPOSAL, not a guarantee. Whether replaying it actually
 * reproduces the row's `facts` is a separate question answered by
 * `backfillPlanReplaysFacts` below — see that docstring for why it cannot be
 * assumed. Callers must gate on it.
 */
export function planBackfill(row: BackfillSourceRow): BackfillPlan | null {
  const parsedFacts = taxReturnFactsSchema.safeParse(row.facts);
  if (!parsedFacts.success) return null; // corrupted row keeps its recovery path

  const parsedExtracted = row.extractedFacts
    ? taxReturnFactsSchema.safeParse(row.extractedFacts)
    : null;

  if (!parsedExtracted?.success) {
    return {
      taxReturnId: row.id,
      document: null,
      overrides: diffOverrides(emptyTaxReturnFacts(row.taxYear), parsedFacts.data),
    };
  }

  return {
    taxReturnId: row.id,
    document: {
      role: "full_return",
      filename: row.sourceFilename,
      vaultDocumentId: row.vaultDocumentId,
      extractedFacts: parsedExtracted.data,
      warnings: row.warnings,
      promptVersion: row.promptVersion,
      model: row.model,
      taxYear: row.taxYear,
    },
    overrides: diffOverrides(parsedExtracted.data, parsedFacts.data),
  };
}

/**
 * Does replaying this plan reproduce `facts` EXACTLY? Pure.
 *
 * This is the whole safety property of the backfill, and it does NOT hold for
 * every row. `diffOverrides` emits per-field overrides for an entity present
 * in `facts` but absent from the base (its `!original` branch), while
 * `applyOverrides` deliberately DROPS an entity override whose key is not
 * already in the list — because letting an override CREATE an entity would
 * also let a stale one resurrect an entity the advisor deleted. So for a
 * manually-entered return holding a K-1, or an extracted return where the
 * advisor added one in the review form, the diff carries the entity and the
 * replay silently discards it. The mirror case — the advisor DELETING an
 * extracted entity — emits no override at all, and the document puts it back.
 *
 * Writing a state row for such a return would make the first `recomputeFacts`
 * rewrite `tax_returns.facts` with those K-1s and Schedule C businesses gone:
 * silent client data loss, no error. Rather than invent an entity-creation
 * override (a design decision this backfill has no standing to make), the
 * runner SKIPS these rows. A skipped row simply has no state row, so
 * `recomputeFacts` throws `MissingTaxReturnStateError` loudly instead.
 *
 * `taxYear` is the `tax_returns.tax_year` COLUMN, not `facts.taxYear` — it is
 * what `recomputeFacts` will be called with, so a row whose persisted facts
 * disagree with its column is correctly rejected too.
 */
export function backfillPlanReplaysFacts(
  taxYear: number,
  plan: BackfillPlan,
  facts: TaxReturnFacts,
): boolean {
  // The id stands in for the not-yet-inserted document row; only provenance
  // and conflict attribution use it, and neither is compared here.
  const docs: MergeDocument[] = plan.document
    ? [{
        id: "backfill",
        role: plan.document.role,
        taxYear: plan.document.taxYear,
        facts: plan.document.extractedFacts,
      }]
    : [];
  return isDeepStrictEqual(assembleFacts(taxYear, docs, plan.overrides).facts, facts);
}
