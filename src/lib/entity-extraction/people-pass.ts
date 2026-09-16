// src/lib/entity-extraction/people-pass.ts
import type { DocumentRegions } from "./region-classifier";

/**
 * The entities the people pass owns. Every other document-evidence entity
 * belongs to the map pass.
 *
 * The split exists so no page is read twice into two different shapes. Phase
 * 3C's open-world pass takes the COMPLEMENT of `claimedPages`, which is what
 * stops it re-extracting a policy the map pass already produced as an
 * invented table.
 */
export const PEOPLE_ENTITY_IDS = [
  "client_household",
  "family_member",
  "related_party",
] as const;

const PEOPLE = new Set<string>(PEOPLE_ENTITY_IDS);

/**
 * Route each classified entity to its pass, and report the pages spanned.
 *
 * `claimedPages` is every page some entity's classified REGION spans — what
 * the classifier named, not what was read. A range that holds no readable
 * text, or that runs past the end of the document, still counts. That
 * over-claim is deliberate: a skipped re-read of an empty page costs nothing,
 * whereas under-claiming lets two passes read one page and emit a duplicate
 * table — the harm the complement exists to prevent.
 */
export function splitRegions(regions: DocumentRegions): {
  people: DocumentRegions;
  map: DocumentRegions;
  claimedPages: number[];
} {
  const people: DocumentRegions = {};
  const map: DocumentRegions = {};
  const claimed = new Set<number>();

  for (const [entityId, ranges] of Object.entries(regions)) {
    (PEOPLE.has(entityId) ? people : map)[entityId] = ranges;
    for (const [start, end] of ranges) {
      for (let page = start; page <= end; page += 1) claimed.add(page);
    }
  }

  return { people, map, claimedPages: [...claimed].sort((a, b) => a - b) };
}
