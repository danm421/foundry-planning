import { isDeepStrictEqual } from "node:util";
import {
  emptyTaxReturnFacts,
  taxReturnFactsSchema,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import { diffOverrides } from "./merge/overrides";
import { ENTITY_COLLECTIONS } from "./merge/paths";
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
 * `backfillReplayDifferences` below — see that docstring for why it cannot be
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
 * Where does replaying this plan stop reproducing `facts`? Pure. An EMPTY
 * array means the replay is exact and the row is safe to backfill; any entry
 * means the row must be SKIPPED.
 *
 * One entry PER DIFFERING TOP-LEVEL KEY, each the first differing dotted path
 * within that key, sorted. Not a single first-difference: a row can differ in
 * more than one place, and reporting only the sorted-first one lets a benign
 * `deductions.*` difference MASK a real `k1s` loss behind it — which would
 * tell an operator "nothing was lost" about a row that is losing a K-1. Three
 * of the four benign nullable blocks sort before `k1s`, so that masking is the
 * common case, not a corner. Callers classify with
 * `differencesIncludeEntities`, never by reading one path.
 *
 * Exact, not "equivalent" — the gate cannot tell a real loss from a harmless
 * shape difference, so it refuses both. Three kinds of difference occur today
 * and only the first is actual data loss, which is why the paths matter:
 *
 *  1. REAL LOSS (`k1s` / `businesses`) — an entity the override layer cannot
 *     express. This was the COMMON case before entities carried a stored
 *     identity: an entity present in `facts` but absent from the base was
 *     emitted by the diff and dropped by the replay, and a DELETED entity
 *     emitted nothing at all so the document put it back. Both now round-trip
 *     (`adv:` keys create, `__deleted` markers delete), so what remains in this
 *     category is an entity neither layer can address at all — which is what
 *     the gate is here to catch if it ever recurs.
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
 * A row can be BOTH 1 and 2 at once. That row is category 1: any entity path
 * present means data would be lost, whatever else is alongside it.
 *
 * Writing a state row for a category-1 return would make the first
 * `recomputeFacts` rewrite `tax_returns.facts` with those K-1s and businesses
 * gone: silent client data loss, no error. The runner SKIPS every rejected row.
 * A skipped row has no state row, so `recomputeFacts` throws
 * `MissingTaxReturnStateError` loudly instead.
 *
 * `entityId` is erased on both sides before comparing. It is ASSIGNED by the
 * assembly layer — `mergeEntities` stamps it, `applyOverrides` mints one for an
 * advisor-created entity — so no legacy row carries it and the replay always
 * does. Comparing it would report every entity-bearing row as differing, and
 * because the path lands inside an entity collection, `differencesIncludeEntities`
 * would classify a purely structural GAIN as data loss and skip a row that
 * replays perfectly.
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
function withoutEntityIds(facts: TaxReturnFacts): Record<string, unknown> {
  const copy = structuredClone(facts) as unknown as Record<string, unknown>;
  for (const collection of ENTITY_COLLECTIONS) {
    const list = copy[collection];
    if (!Array.isArray(list)) continue;
    for (const entity of list) {
      (entity as Record<string, unknown>).entityId = null;
    }
  }
  return copy;
}

export function backfillReplayDifferences(
  taxYear: number,
  plan: BackfillPlan,
  facts: TaxReturnFacts,
): string[] {
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
  const replayed = withoutEntityIds(assembleFacts(taxYear, docs, plan.overrides).facts);
  const stored = withoutEntityIds(facts);

  const roots = [...new Set([...Object.keys(replayed), ...Object.keys(stored)])].sort();
  return roots
    .map((root) => firstDifference(replayed[root], stored[root], root))
    .filter((path): path is string => path !== null);
}

/**
 * Do any of these differing paths name an entity collection? That is the whole
 * classification an operator needs: true means a K-1 or Schedule C business
 * would be dropped and the row cannot migrate until the owner decides how
 * advisor-added entities are represented; false means the gate refused on
 * structure alone and nothing would actually have been lost.
 *
 * An entity difference surfaces either as the collection itself (`"k1s"`, when
 * the lengths differ) or as an indexed field (`"k1s[0].qbiIncome"`), so both
 * shapes are matched.
 */
export function differencesIncludeEntities(paths: readonly string[]): boolean {
  return paths.some((path) =>
    ENTITY_COLLECTIONS.some((c) => path === c || path.startsWith(`${c}[`)),
  );
}
