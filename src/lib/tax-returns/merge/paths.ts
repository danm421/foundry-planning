import type { EntityCollection } from "./types";

/** The entity-array fields on `TaxReturnFacts` — merged and overridden by
 *  key, never as scalar leaves. Shared so `merge-documents.ts` and
 *  `overrides.ts` walk the same set of collections. */
export const ENTITY_COLLECTIONS: readonly EntityCollection[] = ["businesses", "k1s"];

/**
 * Identity for an entity across documents and recomputes. EIN when the
 * document carried one, otherwise a normalized name.
 *
 * This is deliberately derived from the DOCUMENT's values, not from merged or
 * overridden ones: an advisor correcting a misread entity name must not
 * change the key their other edits are filed under.
 *
 * Accepts both entity shapes: a K-1's `entityName`/`ein` and a Schedule C's
 * `name` (it has neither of the other two). EIN wins when present, then
 * `entityName`, then `name`.
 */
export function entityKey(
  entity: { ein?: string | null; entityName?: string | null; name?: string | null },
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
