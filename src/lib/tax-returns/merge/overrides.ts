import {
  derivedEntityKey, entityKey, entityPath, ENTITY_COLLECTIONS, ENTITY_DELETED_FIELD,
  isAdvisorKey, newAdvisorKey, parseEntityPath, storedEntityId,
} from "./paths";
import type { EntityCollection } from "./types";
import { ENTITY_FACTORIES, NULLABLE_BLOCK_FACTORIES } from "./nullable-blocks";
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

/** One entity, collection-qualified — the same `collection[key]` prefix
 *  `entityPath` builds, without a field. Deletions are tracked by it so a
 *  `k1s[X]` marker can never delete `businesses[X]`. */
function entityRef(collection: EntityCollection, key: string): string {
  return `${collection}[${key}]`;
}

/**
 * Advisor edits layered over the document-merged facts. Pure — the input is
 * never mutated. Unknown paths are ignored, so a stale override left by a
 * removed document can never corrupt the shape.
 *
 * Entities are addressed by their stamped `entityId` (see `entityKey`), which
 * is what lets an edit outlive the advisor renaming the entity it belongs to.
 *
 * An override may CREATE an entity only under an `adv:` key, and DELETE one
 * under any key. Those two are not symmetric, and the asymmetry is the point:
 * no document can produce an `adv:` key, so a stale override can never
 * resurrect a document-sourced entity — the failure Task 7's blanket refusal
 * was protecting against — while a deletion left over from a removed document
 * simply matches nothing and is dropped like any other unknown key.
 */
export function applyOverrides(facts: TaxReturnFacts, overrides: OverrideMap): TaxReturnFacts {
  const out = structuredClone(facts) as unknown as Record<string, unknown>;

  // Deletions are collected up front so the result never depends on the
  // enumeration order of a persisted jsonb object: a deletion always outranks
  // a field edit on the same entity, whichever key the map happens to list first.
  const deleted = new Set<string>();
  for (const [path, value] of Object.entries(overrides)) {
    const entity = parseEntityPath(path);
    if (entity && entity.field === ENTITY_DELETED_FIELD && value === true) {
      deleted.add(entityRef(entity.collection, entity.key));
    }
  }

  for (const [path, value] of Object.entries(overrides)) {
    const entity = parseEntityPath(path);
    if (!entity) {
      applyScalarPath(out, path, value);
      continue;
    }
    if (entity.field === ENTITY_DELETED_FIELD) continue; // handled above
    if (deleted.has(entityRef(entity.collection, entity.key))) continue;

    const list = out[entity.collection] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(list)) continue;

    let target = list.find((e) => entityKey(e) === entity.key);
    if (!target && isAdvisorKey(entity.key)) {
      target = { ...ENTITY_FACTORIES[entity.collection](), entityId: entity.key };
      list.push(target);
    }
    if (!target || !(entity.field in target)) continue;
    target[entity.field] = value;
  }

  if (deleted.size > 0) {
    for (const collection of ENTITY_COLLECTIONS) {
      const list = out[collection];
      if (!Array.isArray(list)) continue;
      out[collection] = (list as Array<Record<string, unknown>>).filter(
        (e) => !deleted.has(entityRef(collection, entityKey(e) ?? "")),
      );
    }
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
 * Which entity in `base` is this submitted entity? Its stamped `entityId`
 * first, then the derived key.
 *
 * The derived fallback is what pairs the two on the FIRST save after a
 * backfill, when neither side carries a stamp yet. It is tried only when the
 * stamp is absent — trying it first would undo the whole point, since renaming
 * the entity is precisely what changes the derived value.
 */
function matchBaseEntity(
  baseList: ReadonlyArray<Record<string, unknown>>,
  submitted: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const stored = storedEntityId(submitted);
  if (stored) return baseList.find((e) => entityKey(e) === stored);
  const derived = derivedEntityKey(submitted);
  return derived ? baseList.find((e) => entityKey(e) === derived) : undefined;
}

/**
 * The sparse set of edits that turns `base` into `submitted`. The review form
 * still PUTs a whole facts object; this is what reduces it to overrides, so
 * the form never has to know overrides exist.
 *
 * NOT deterministic for an entity the advisor ADDED: it has no identity yet,
 * so one is minted (`newAdvisorKey`). Every other output is a pure function of
 * the inputs. The minted key is stable from the advisor's second save onward,
 * because `applyOverrides` writes it onto the created entity and the form
 * round-trips it back.
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
    const kept = new Set<string>();

    for (const entity of submittedList) {
      const original = matchBaseEntity(baseList, entity);
      // An entity matching nothing in `base` is one the advisor ADDED, and it
      // gets an `adv:` key — the only namespace `applyOverrides` will create
      // under. A matched entity keeps the base entity's key, so a rename edits
      // the entity it renames instead of forking a second copy of it.
      const key = original
        ? entityKey(original)
        : storedEntityId(entity) ?? newAdvisorKey();
      if (!key) continue;
      kept.add(key);

      for (const [field, value] of Object.entries(entity)) {
        if (field === "entityId") continue; // identity is the key, never a value
        if (!original || original[field] !== value) {
          overrides[entityPath(collection, key, field)] = value;
        }
      }
    }

    // An entity the advisor REMOVED. Only document-sourced entities need a
    // marker: an `adv:` one exists purely as overrides, so leaving it out of
    // this map already deletes it.
    for (const original of baseList) {
      const key = entityKey(original);
      if (key && !kept.has(key)) {
        overrides[entityPath(collection, key, ENTITY_DELETED_FIELD)] = true;
      }
    }
  }

  return overrides;
}
