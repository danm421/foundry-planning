import {
  emptyAdjustmentsDetail,
  emptyQbi,
  emptyScheduleA,
  emptyScheduleE,
  emptyTaxReturnFacts,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import type {
  DroppedValue, EntityCollection, FieldConflict, MergeDocument, MergeEntity, MergeResult,
} from "./types";
import { entityKey, entityPath } from "./paths";

/** Roles permitted to contribute entities. A W-2 names one employer; it is
 *  never a K-1 and never a Schedule C. */
const ENTITY_AUTHORITATIVE: ReadonlySet<MergeDocument["role"]> = new Set(["full_return", "k1"]);

const ENTITY_COLLECTIONS: readonly EntityCollection[] = ["businesses", "k1s"];

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

/** `setLeaf` seeds a missing intermediate object from these factories rather
 *  than `{}`. Every field in these blocks is `.nullable()` with no
 *  `.optional()`/`.default()`, so the strict schema REQUIRES every key —
 *  seeding `{}` and filling only the touched fields leaves the rest
 *  `undefined`, which fails `taxReturnFactsSchema` (and, once persisted,
 *  fails `parseRowFacts` on the next read). Keyed by the dotted path to the
 *  block itself, checked while `setLeaf` walks the path's prefix. */
const NULLABLE_BLOCK_FACTORIES: Readonly<Record<string, () => object>> = {
  "income.scheduleE": emptyScheduleE,
  "income.adjustmentsDetail": emptyAdjustmentsDetail,
  "deductions.scheduleA": emptyScheduleA,
  "deductions.qbi": emptyQbi,
};

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
 */
function mergeEntities(
  docs: MergeDocument[],
  collection: EntityCollection,
  provenance: Record<string, string>,
  conflicts: FieldConflict[],
): MergeEntity[] {
  const byKey = new Map<string, { entity: Record<string, unknown>; key: string }>();

  for (const doc of docs) {
    if (!doc.facts || !ENTITY_AUTHORITATIVE.has(doc.role)) continue;
    const list = (doc.facts as unknown as Record<string, unknown>)[collection] as MergeEntity[];
    if (!Array.isArray(list)) continue;

    for (const [index, incoming] of list.entries()) {
      const key = entityKey(incoming) ?? `doc:${doc.id}:${index}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { entity: { ...(incoming as Record<string, unknown>) }, key });
        for (const [field, value] of Object.entries(incoming as Record<string, unknown>)) {
          if (value !== null) provenance[entityPath(collection, key, field)] = doc.id;
        }
        continue;
      }
      for (const [field, value] of Object.entries(incoming as Record<string, unknown>)) {
        if (value === null || value === undefined) continue;
        const path = entityPath(collection, key, field);
        const previous = existing.entity[field];
        const previousDoc = provenance[path];
        if (previous !== null && previous !== undefined && previous !== value && previousDoc) {
          conflicts.push({
            path,
            winner: { documentId: doc.id, value },
            losers: [{ documentId: previousDoc, value: previous }],
          });
        }
        existing.entity[field] = value;
        provenance[path] = doc.id;
      }
    }
  }

  return [...byKey.values()].map((e) => e.entity as unknown as MergeEntity);
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
    const merged = mergeEntities(docs, collection, provenance, conflicts);
    (facts as unknown as Record<string, unknown>)[collection] = merged;
  }

  return { facts, provenance, conflicts, dropped };
}
