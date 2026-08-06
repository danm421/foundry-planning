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
 * `backfillReplayDifference` below — see that docstring for why it cannot be
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
 * The first dotted path at which two facts objects differ, or null when they
 * are deep-equal. Keys are visited in sorted order so the reported path is
 * deterministic run to run; arrays descend by index, and a length mismatch is
 * reported at the array's own path (`"k1s"`) rather than at an element.
 */
function firstDifference(replayed: unknown, stored: unknown, path: string): string | null {
  if (isDeepStrictEqual(replayed, stored)) return null;

  const isPlainObject = (v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  if (isPlainObject(replayed) && isPlainObject(stored)) {
    const a = replayed as Record<string, unknown>;
    const b = stored as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const child = firstDifference(a[key], b[key], path ? `${path}.${key}` : key);
      if (child) return child;
    }
  } else if (
    Array.isArray(replayed) && Array.isArray(stored) &&
    replayed.length === stored.length
  ) {
    for (let i = 0; i < replayed.length; i++) {
      const child = firstDifference(replayed[i], stored[i], `${path}[${i}]`);
      if (child) return child;
    }
  }

  // Either a leaf differs, or the two containers differ in a way no child
  // does (differing array lengths). Both are reported here.
  return path || "<root>";
}

/**
 * Where does replaying this plan stop reproducing `facts`? Pure. `null` means
 * the replay is EXACT and the row is safe to backfill; any string is the first
 * differing dotted path and the row must be SKIPPED.
 *
 * Exact, not "equivalent" — the gate cannot tell a real loss from a harmless
 * shape difference, so it refuses both. Three kinds of row are rejected today
 * and only the first is actual data loss, which is why the path matters:
 *
 *  1. REAL LOSS (`k1s` / `businesses`) — an entity the override layer cannot
 *     express. `diffOverrides` emits per-field overrides for an entity present
 *     in `facts` but absent from the base (its `!original` branch), while
 *     `applyOverrides` deliberately DROPS an entity override whose key is not
 *     already in the list, because letting an override CREATE an entity would
 *     also let a stale one resurrect an entity the advisor deleted. So a
 *     manually-entered return holding a K-1, or an extracted one where the
 *     advisor added a Schedule C in the review form, has its entity carried by
 *     the diff and silently discarded by the replay. The mirror case — the
 *     advisor DELETING an extracted entity — emits no override at all and the
 *     document puts it back.
 *
 *  2. CONSERVATIVE REFUSAL — an extraction that materialized a nullable block
 *     (`deductions.scheduleA`, `income.scheduleE`, `deductions.qbi`,
 *     `income.adjustmentsDetail`) as an ALL-NULL OBJECT instead of omitting
 *     it. `collectLeaves` returns early on every null, so the merge leaves the
 *     block `null` and the diff has nothing to say. An all-null block and
 *     `null` mean the same thing to every reader, so NOTHING would be lost —
 *     the gate refuses structurally anyway.
 *
 *  3. CONSERVATIVE REFUSAL — a persisted `facts.taxYear` disagreeing with the
 *     `tax_year` column, on an extracted row. See the `taxYear` note below.
 *
 * Writing a state row for a category-1 return would make the first
 * `recomputeFacts` rewrite `tax_returns.facts` with those K-1s and businesses
 * gone: silent client data loss, no error. Rather than invent an
 * entity-creation override (a design decision this backfill has no standing to
 * make), the runner SKIPS every rejected row. A skipped row has no state row,
 * so `recomputeFacts` throws `MissingTaxReturnStateError` loudly instead.
 *
 * `taxYear` is the `tax_returns.tax_year` COLUMN, not `facts.taxYear` — it is
 * what `recomputeFacts` will be called with. No document can write `taxYear`
 * (it is in neither `SCALAR_ROOTS` nor `TOP_LEVEL_SCALARS`), so on an
 * EXTRACTED row a persisted `facts.taxYear` that disagrees with the column is
 * rejected. On a MANUALLY-ENTERED row it is NOT: the base is
 * `emptyTaxReturnFacts(column)`, so the diff emits `taxYear` as an ordinary
 * scalar override and the replay reproduces the disagreement faithfully. That
 * is accepted on purpose — the backfill preserves an existing inconsistency,
 * it does not introduce one.
 */
export function backfillReplayDifference(
  taxYear: number,
  plan: BackfillPlan,
  facts: TaxReturnFacts,
): string | null {
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
  return firstDifference(assembleFacts(taxYear, docs, plan.overrides).facts, facts, "");
}
