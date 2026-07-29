// src/lib/household-map/scenario-fields.ts
//
// The one rule every Household Map scenario payload obeys: prune an EFFECTIVE
// row or singleton down to the field set a `scenario_changes` edit may send.
//
// Dropping `undefined` is load-bearing, not tidying. The engine's loaders write
// `x ?? undefined` for every absent optional column, while the BASE tree those
// values get diffed against carries `null`. `valuesEqual(null, undefined)` is
// false, so an explicit `undefined` would diff as a change and then vanish in
// `JSON.stringify` — writing "no value" over a real base value. `null` is NOT
// pruned: it is a real stored value ("this person has no spouse LE on record"),
// and dropping it would silently stop the scenario overriding it.
//
// `applyEntityEdit` additionally filters singleton fields to keys the base
// singleton carries, so anything non-overlayable is dropped server-side too;
// this is the belt to that braces.
//
// Extracted because the rule (and the paragraph above it) had been written out
// three times — `flow-write.ts`, `life-expectancy-write.ts`, and the loop in
// `account-write.ts`. `strip` is a PARAMETER rather than a shared constant on
// purpose: the flow rows have keys that must never be sent, the singletons have
// none, and a shared default would silently start stripping a singleton the day
// `client` gains an `id`.

/**
 * Copy `row`, dropping `undefined` values and any key in `strip`.
 *
 * Runs SERVER-side (`map-content.tsx`) so the browser never has to know the
 * engine's field list.
 */
export function pruneScenarioFields<T extends object>(
  row: T,
  strip?: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (strip?.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}
