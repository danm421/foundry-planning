import {
  emptyAdjustmentsDetail,
  emptyQbi,
  emptyScheduleA,
  emptyScheduleE,
  emptyTaxReturnFacts,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import type {
  DroppedValue, FieldConflict, MergeDocument, MergeResult,
} from "./types";

/** Roles permitted to write 1040 aggregate scalars. A W-2 is one of many on
 *  line 1a and a K-1 is one of many inside Schedule 1 line 5, so neither can
 *  ever state the aggregate — this is structural, not a prompt promise. */
const SCALAR_AUTHORITATIVE: ReadonlySet<MergeDocument["role"]> = new Set(["full_return"]);

/** Blocks walked as scalars. `businesses` / `k1s` are handled in Task 6.
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

  return { facts, provenance, conflicts, dropped };
}
