import { entityKey, entityPath, ENTITY_COLLECTIONS, parseEntityPath } from "./paths";
import { NULLABLE_BLOCK_FACTORIES } from "./nullable-blocks";
import type { OverrideMap } from "./types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";

function applyScalarPath(facts: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let node = facts;
  for (let i = 0; i < segments.length - 1; i++) {
    const prefix = segments.slice(0, i + 1).join(".");
    const key = segments[i];
    if (node[key] === null || node[key] === undefined) {
      const factory = NULLABLE_BLOCK_FACTORIES[prefix];
      if (!factory) return; // unknown path — never grow the object
      node[key] = factory();
    }
    if (typeof node[key] !== "object") return;
    node = node[key] as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1];
  if (!(leaf in node)) return; // unknown leaf — ignore rather than invent
  node[leaf] = value;
}

/** Advisor edits layered over the document-merged facts. Pure — the input is
 *  never mutated. Unknown paths are ignored, so a stale override left by a
 *  removed document can never corrupt the shape. */
export function applyOverrides(facts: TaxReturnFacts, overrides: OverrideMap): TaxReturnFacts {
  const out = structuredClone(facts) as unknown as Record<string, unknown>;

  for (const [path, value] of Object.entries(overrides)) {
    const entity = parseEntityPath(path);
    if (!entity) {
      applyScalarPath(out, path, value);
      continue;
    }
    const list = out[entity.collection] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(list)) continue;
    const target = list.find((e) => entityKey(e) === entity.key);
    // An override whose key is no longer present is dropped, never used to
    // CREATE an entity. `diffOverrides` emits per-field overrides for a
    // brand-new entity in `submitted` (the `!original` branch below), so an
    // advisor adding a K-1 in the review form produces overrides this layer
    // will silently ignore. That's intentional, not a gap to close here:
    // letting an override create an entity would also let a stale override
    // RESURRECT one the advisor deleted, which is exactly the failure this
    // ignore-unknown-key rule exists to prevent. Adding/removing entities is
    // a document-layer operation, not an override-layer one.
    if (!target || !(entity.field in target)) continue;
    target[entity.field] = value;
  }

  return out as unknown as TaxReturnFacts;
}

function collectLeafPaths(node: unknown, path: string, out: Map<string, unknown>): void {
  if (node === null || node === undefined || typeof node !== "object" || Array.isArray(node)) {
    if (path) out.set(path, node ?? null);
    return;
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    collectLeafPaths(child, path ? `${path}.${key}` : key, out);
  }
}

/**
 * The sparse set of edits that turns `base` into `submitted`. The review form
 * still PUTs a whole facts object; this is what reduces it to overrides, so
 * the form never has to know overrides exist.
 */
export function diffOverrides(base: TaxReturnFacts, submitted: TaxReturnFacts): OverrideMap {
  const overrides: OverrideMap = {};

  const baseLeaves = new Map<string, unknown>();
  const submittedLeaves = new Map<string, unknown>();
  const baseRecord = base as unknown as Record<string, unknown>;
  const submittedRecord = submitted as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(submittedRecord)) {
    if ((ENTITY_COLLECTIONS as readonly string[]).includes(key)) continue;
    collectLeafPaths(value, key, submittedLeaves);
  }
  for (const [key, value] of Object.entries(baseRecord)) {
    if ((ENTITY_COLLECTIONS as readonly string[]).includes(key)) continue;
    collectLeafPaths(value, key, baseLeaves);
  }

  for (const [path, value] of submittedLeaves) {
    if (baseLeaves.get(path) !== value) overrides[path] = value;
  }

  for (const collection of ENTITY_COLLECTIONS) {
    const baseList = (baseRecord[collection] ?? []) as Array<Record<string, unknown>>;
    const submittedList = (submittedRecord[collection] ?? []) as Array<Record<string, unknown>>;
    for (const entity of submittedList) {
      const key = entityKey(entity);
      if (!key) continue;
      const original = baseList.find((e) => entityKey(e) === key);
      for (const [field, value] of Object.entries(entity)) {
        if (!original || original[field] !== value) {
          overrides[entityPath(collection, key, field)] = value;
        }
      }
    }
  }

  return overrides;
}
