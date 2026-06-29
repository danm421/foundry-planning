// src/lib/solver/projection-wire.ts
//
// JSON wire (de)serialization for the live-solver recompute response.
//
// `ProjectionYear` carries several `Map` fields (entityAccountSharesEoY,
// familyAccountSharesEoY, entityCashFlow, trustTaxByEntity, …). A plain
// `JSON.stringify` flattens every Map to `{}` — losing its entries AND its
// `.get` method. Estate consumers (e.g. computePortfolioAssets) then call
// `yearRow.familyAccountSharesEoY?.get(...)`; because `{}` is truthy the
// optional-chain doesn't short-circuit and `{}.get` throws "is not a function",
// crashing the page.
//
// The INITIAL projection reaches the client via RSC props (React's Flight
// format preserves Map), so it works; only the fetch-based recompute lost them.
// These two helpers restore parity: the route serializes with `mapReplacer`,
// the client parses with `mapReviver`. The tagged-wrapper encoding handles
// arbitrarily nested Maps without enumerating the projection's field list.

const MAP_TAG = "__solverMap__";

interface TaggedMap {
  [MAP_TAG]: true;
  entries: [unknown, unknown][];
}

function isTaggedMap(value: unknown): value is TaggedMap {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[MAP_TAG] === true &&
    Array.isArray((value as Record<string, unknown>).entries)
  );
}

/** `JSON.stringify` replacer: encode every Map as a tagged wrapper. Nested Maps
 *  are handled automatically — stringify recurses into `entries`, re-invoking
 *  the replacer on any inner Map values. */
export function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { [MAP_TAG]: true, entries: Array.from(value.entries()) };
  }
  return value;
}

/** `JSON.parse` reviver: rebuild Maps from tagged wrappers. `parse` revives
 *  bottom-up, so inner Maps are already reconstructed when an outer wrapper is
 *  seen — `new Map(entries)` therefore nests correctly. */
export function mapReviver(_key: string, value: unknown): unknown {
  if (isTaggedMap(value)) {
    return new Map(value.entries as [unknown, unknown][]);
  }
  return value;
}

/** Serialize a recompute response body, preserving Map fields. */
export function serializeProjectionResponse(body: unknown): string {
  return JSON.stringify(body, mapReplacer);
}

/** Parse a recompute response body, reviving Map fields. */
export function parseProjectionResponse<T>(text: string): T {
  return JSON.parse(text, mapReviver) as T;
}
