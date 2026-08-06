import type { EntityCollection } from "./types";

/** The entity-array fields on `TaxReturnFacts` — merged and overridden by
 *  key, never as scalar leaves. Shared so `merge-documents.ts` and
 *  `overrides.ts` walk the same set of collections. */
export const ENTITY_COLLECTIONS: readonly EntityCollection[] = ["businesses", "k1s"];

/**
 * Key namespace for an entity the ADVISOR created in the review form, rather
 * than one any document supplied.
 *
 * The prefix is the safety property, not a label. `applyOverrides` may CREATE
 * an entity only under an advisor key, and no key any document can produce is
 * ever one — `derivedEntityKey` yields an EIN or a `name:` key, and
 * `mergeEntities` falls back to `doc:`. So an override left behind by a removed
 * document can never resurrect the entity it described, which is the rule
 * Task 7 established and this preserves.
 */
export const ADVISOR_KEY_PREFIX = "adv:";

export function isAdvisorKey(key: string): boolean {
  return key.startsWith(ADVISOR_KEY_PREFIX);
}

export function newAdvisorKey(): string {
  return `${ADVISOR_KEY_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Pseudo-field marking an entity the advisor REMOVED. Deleting an extracted
 * entity has to leave a trace: the document still contains it, so every
 * recompute would otherwise put it straight back.
 *
 * It lives inside the entity-path namespace on purpose. If the document that
 * produced the entity is later removed, its key stops appearing in the merged
 * facts and `applyOverrides` drops this override along with every other
 * unknown key — a deletion can never outlive the thing it deletes.
 */
export const ENTITY_DELETED_FIELD = "__deleted";

/**
 * The key that unions the same entity across DOCUMENTS. EIN when the document
 * carried one, otherwise a normalized name.
 *
 * Deliberately derived from the document's own values: two independent
 * extractions of the same K-1 can never agree on a minted id, but they do
 * agree on an EIN, and usually on a name.
 *
 * Accepts both entity shapes: a K-1's `entityName`/`ein` and a Schedule C's
 * `name` (it has neither of the other two). EIN wins when present, then
 * `entityName`, then `name`.
 */
export function derivedEntityKey(
  entity: {
    /** Accepted so a whole entity can be passed, and deliberately IGNORED —
     *  see the union-key note in `mergeEntities`. */
    entityId?: string | null;
    ein?: string | null;
    entityName?: string | null;
    name?: string | null;
  },
): string | null {
  const ein = entity.ein?.trim();
  if (ein) return ein;
  const normalized = (entity.entityName ?? entity.name ?? "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? `name:${normalized}` : null;
}

/**
 * Identity for an entity as the OVERRIDE layer addresses it.
 *
 * `entityId` is the stored identity `mergeEntities` stamps onto every merged
 * entity. It wins over anything derived, and that is the whole point: an
 * advisor correcting an OCR-garbled name — the canonical review-form edit —
 * changes every derived value, so a key re-derived from the submitted entity
 * would file the rename, and every correction beside it, under a key nothing
 * matches. The stamp also gives an entity carrying neither EIN nor name a
 * key at all, where derivation returns null and leaves it uneditable.
 *
 * Falls back to derivation so that entities persisted before the stamp existed
 * still resolve, and so a document's extraction (which never carries an id)
 * keys the same way it always did.
 */
export function entityKey(
  entity: {
    entityId?: string | null;
    ein?: string | null;
    entityName?: string | null;
    name?: string | null;
  },
): string | null {
  return storedEntityId(entity) ?? derivedEntityKey(entity);
}

/** The entity's stamped identity, or null when it has none yet — a document's
 *  extraction, a row persisted before the stamp existed, or an entity the
 *  advisor has just added in the form. Blank strings count as none. */
export function storedEntityId(entity: { entityId?: unknown }): string | null {
  if (typeof entity.entityId !== "string") return null;
  const trimmed = entity.entityId.trim();
  return trimmed || null;
}

export function entityPath(collection: EntityCollection, key: string, field: string): string {
  return `${collection}[${key}].${field}`;
}

const ENTITY_PATH = /^(businesses|k1s)\[(.+)\]\.([A-Za-z0-9_]+)$/;

export function parseEntityPath(
  path: string,
): { collection: EntityCollection; key: string; field: string } | null {
  const match = ENTITY_PATH.exec(path);
  if (!match) return null;
  return {
    collection: match[1] as EntityCollection,
    key: match[2],
    field: match[3],
  };
}
