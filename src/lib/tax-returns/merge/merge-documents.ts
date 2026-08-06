import {
  emptyTaxReturnFacts,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import type {
  DroppedValue, EntityCollection, FieldConflict, MergeDocument, MergeEntity, MergeResult,
} from "./types";
import { derivedEntityKey, entityPath, ENTITY_COLLECTIONS, parseEntityPath } from "./paths";
import { NULLABLE_BLOCK_FACTORIES } from "./nullable-blocks";

/** Roles permitted to contribute entities. A W-2 names one employer; it is
 *  never a K-1 and never a Schedule C. */
const ENTITY_AUTHORITATIVE: ReadonlySet<MergeDocument["role"]> = new Set(["full_return", "k1"]);

/** Roles permitted to write 1040 aggregate scalars. A W-2 is one of many on
 *  line 1a and a K-1 is one of many inside Schedule 1 line 5, so neither can
 *  ever state the aggregate — this is structural, not a prompt promise. */
const SCALAR_AUTHORITATIVE: ReadonlySet<MergeDocument["role"]> = new Set(["full_return"]);

/** Blocks walked as scalars. `businesses` / `k1s` are entity arrays, merged
 *  separately by `mergeEntities` below — never scalar leaves.
 *
 *  Precedence inside a nullable block (`income.scheduleE`, `deductions.qbi`,
 *  etc.) is PER-LEAF, same as every other scalar — `collectLeaves` flattens
 *  the block into individual dotted paths and each one is resolved
 *  independently. A document can therefore win `scheduleE.grossRents` while
 *  an earlier document keeps `scheduleE.totalExpenses`. That is intentional,
 *  not an oversight to "fix" into whole-block replacement: it is the same
 *  null-fill-without-conflict rule this file's first test pins for top-level
 *  scalars, just applied one level deeper. */
const SCALAR_ROOTS = ["income", "deductions", "tax", "payments", "carryovers"] as const;

const TOP_LEVEL_SCALARS = [
  "filingStatus", "residenceState", "dependentsUnder17", "dependents17to23",
] as const;

/**
 * Compile-time proof that every top-level key of `TaxReturnFacts` is claimed by
 * one of the lists above (or is `taxYear`, which the merge takes from its
 * argument rather than from any document).
 *
 * This matters more than it looks. `recomputeFacts` is the SINGLE writer of
 * `tax_returns.facts`, and `mergeDocuments` starts from `emptyTaxReturnFacts`
 * and fills in only what these lists name. A root that appears in the schema
 * but in none of them is therefore not merely un-merged — it is silently reset
 * to null on every recompute. Adding a block to the facts schema and
 * forgetting this file would quietly blank total tax, withholding, refunds or
 * the filing status, with no error and no failing test.
 *
 * If this line stops compiling, the fix is to add the new key to `SCALAR_ROOTS`
 * (a nested block of scalars), `TOP_LEVEL_SCALARS` (a bare scalar), or
 * `ENTITY_COLLECTIONS` in `paths.ts` (an array merged by identity).
 */
type CoveredFactsKey =
  | (typeof SCALAR_ROOTS)[number]
  | (typeof TOP_LEVEL_SCALARS)[number]
  | EntityCollection
  | "taxYear";

type MustBeNever<T extends never> = T;
export type UnmergedFactsKey =
  MustBeNever<Exclude<keyof TaxReturnFacts, CoveredFactsKey>>;

interface Candidate {
  documentId: string;
  value: unknown;
}

/** Walk a facts object collecting every non-null leaf as a dotted path. */
function collectLeaves(
  node: unknown,
  path: string,
  out: Map<string, unknown>,
): void {
  if (node === null || node === undefined) return;
  if (typeof node !== "object" || Array.isArray(node)) {
    out.set(path, node);
    return;
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    collectLeaves(child, path ? `${path}.${key}` : key, out);
  }
}

function setLeaf(facts: TaxReturnFacts, path: string, value: unknown): void {
  const segments = path.split(".");
  let node = facts as unknown as Record<string, unknown>;
  let prefix = "";
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    prefix = prefix ? `${prefix}.${key}` : key;
    if (node[key] === null || node[key] === undefined) {
      const seed = NULLABLE_BLOCK_FACTORIES[prefix];
      node[key] = seed ? seed() : {};
    }
    node = node[key] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

/**
 * Union entities across documents, keyed by EIN or normalized name so that a
 * re-uploaded K-1 UPDATES its entry rather than appending a duplicate.
 * Unkeyable entities (no EIN, no name) are kept under a per-document synthetic
 * key — dropping them would lose a real K-1 over a missing header.
 *
 * The union key is DERIVED, never the incoming `entityId`: two independent
 * extractions of the same K-1 could never agree on a minted id, so honouring
 * one would split the entity in two. Extraction does not emit `entityId` at
 * all — the field is stamped HERE, onto each merged entity, from the key it
 * was filed under. That stamp is the entity's stable identity for every layer
 * above: it survives the advisor renaming the entity, and it gives an entity
 * with neither EIN nor name an address it otherwise never had. `entityId` is
 * consequently excluded from the candidate/conflict machinery below — it is
 * identity, not a value any document gets to state.
 *
 * Conflict resolution mirrors the scalar path exactly (see the loop below vs.
 * `mergeDocuments`'s own `candidates` loop): every document's non-null value
 * for a given entity field is accumulated as a `Candidate` first, and only
 * once every document has been seen is one `FieldConflict` emitted per path —
 * winner is the true final value, losers are every earlier candidate that
 * differs from it. Resolving pairwise as documents arrive would let `winner`
 * drift from what the merge actually kept once a third document showed up,
 * and would silently drop an earlier document's attribution whenever two
 * adjacent values happened to repeat before the value changed.
 *
 * A document whose role may not contribute entities (anything but
 * `full_return` / `k1`, and not `other`) records one `DroppedValue` per
 * entity it tried to write — never silently discarded, mirroring the scalar
 * path's `dropped.push` for the same "never permissible" situation.
 */
function mergeEntities(
  docs: MergeDocument[],
  collection: EntityCollection,
  provenance: Record<string, string>,
  conflicts: FieldConflict[],
  dropped: DroppedValue[],
): MergeEntity[] {
  const entities = new Map<string, Record<string, unknown>>();
  const candidates = new Map<string, Candidate[]>();

  for (const doc of docs) {
    if (!doc.facts) continue;
    if (doc.role === "other") continue; // stored for the list, never merged — silent on both sides

    const entityList = (doc.facts as unknown as Record<string, unknown>)[collection] as MergeEntity[];
    if (!Array.isArray(entityList)) continue;

    if (!ENTITY_AUTHORITATIVE.has(doc.role)) {
      for (const [index, incoming] of entityList.entries()) {
        const key = derivedEntityKey(incoming) ?? `doc:${doc.id}:${index}`;
        dropped.push({
          path: entityPath(collection, key, "*"),
          documentId: doc.id,
          value: incoming,
          reason: `a ${doc.role} document cannot contribute ${collection}`,
        });
      }
      continue;
    }

    for (const [index, incoming] of entityList.entries()) {
      const key = derivedEntityKey(incoming) ?? `doc:${doc.id}:${index}`;
      if (!entities.has(key)) {
        entities.set(key, { ...(incoming as Record<string, unknown>) });
      }
      for (const [field, value] of Object.entries(incoming as Record<string, unknown>)) {
        if (field === "entityId") continue; // stamped from `key` below, never merged
        if (value === null || value === undefined) continue;
        const path = entityPath(collection, key, field);
        const fieldCandidates = candidates.get(path) ?? [];
        fieldCandidates.push({ documentId: doc.id, value });
        candidates.set(path, fieldCandidates);
      }
    }
  }

  for (const [path, pathCandidates] of candidates) {
    const parsed = parseEntityPath(path);
    if (!parsed) continue; // entityPath always produces a parseable path
    const winner = pathCandidates[pathCandidates.length - 1];
    const entity = entities.get(parsed.key);
    if (entity) entity[parsed.field] = winner.value;
    provenance[path] = winner.documentId;

    const losers = pathCandidates
      .slice(0, -1)
      .filter((c) => c.value !== winner.value);
    if (losers.length > 0) {
      conflicts.push({ path, winner, losers });
    }
  }

  return [...entities.entries()].map(
    ([key, entity]) => ({ ...entity, entityId: key }) as unknown as MergeEntity,
  );
}

/**
 * Merge every document's extraction into one set of facts.
 *
 * Documents arrive OLDEST FIRST. Within the set of documents permitted to
 * write a given path, the last non-null value wins and every earlier
 * DIFFERENT value is recorded as a conflict. Equal values are not a conflict.
 */
export function mergeDocuments(taxYear: number, docs: MergeDocument[]): MergeResult {
  const facts = emptyTaxReturnFacts(taxYear);
  const provenance: Record<string, string> = {};
  const conflicts: FieldConflict[] = [];
  const dropped: DroppedValue[] = [];

  const candidates = new Map<string, Candidate[]>();

  for (const doc of docs) {
    if (!doc.facts) continue;      // unparseable document contributes nothing
    if (doc.role === "other") continue; // stored for the list, never merged

    const leaves = new Map<string, unknown>();
    for (const root of SCALAR_ROOTS) {
      collectLeaves((doc.facts as unknown as Record<string, unknown>)[root], root, leaves);
    }
    for (const key of TOP_LEVEL_SCALARS) {
      const value = (doc.facts as unknown as Record<string, unknown>)[key];
      if (value !== null && value !== undefined) leaves.set(key, value);
    }

    const mayWriteScalars = SCALAR_AUTHORITATIVE.has(doc.role);
    for (const [path, value] of leaves) {
      if (!mayWriteScalars) {
        dropped.push({
          path,
          documentId: doc.id,
          value,
          reason: `a ${doc.role} document cannot state a 1040 aggregate`,
        });
        continue;
      }
      const list = candidates.get(path) ?? [];
      list.push({ documentId: doc.id, value });
      candidates.set(path, list);
    }
  }

  for (const [path, list] of candidates) {
    const winner = list[list.length - 1];
    setLeaf(facts, path, winner.value);
    provenance[path] = winner.documentId;

    const losers = list
      .slice(0, -1)
      .filter((c) => c.value !== winner.value);
    if (losers.length > 0) {
      conflicts.push({ path, winner, losers });
    }
  }

  for (const collection of ENTITY_COLLECTIONS) {
    const merged = mergeEntities(docs, collection, provenance, conflicts, dropped);
    (facts as unknown as Record<string, unknown>)[collection] = merged;
  }

  return { facts, provenance, conflicts, dropped };
}
