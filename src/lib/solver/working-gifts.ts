// src/lib/solver/working-gifts.ts
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { SolverMutation } from "@/lib/solver/types";

/**
 * Fold the scenario's `gift-upsert` mutations over the base-plan gift drafts to
 * produce the working `EstateFlowGift[]`.
 *
 * Why derive rather than read state: the Solver's editable gift list lives in
 * `useSolverEstateEditor`, local to the Techniques tab, and `applyMutations`
 * folds gifts into the ENGINE tree (`ClientData.gifts` / `giftEvents` via
 * `applyGiftsToClientData`) — neither hands back the draft shape that
 * `buildEstateFlowSummary` consumes. The mutation list is the canonical record
 * of gift edits (it is what gets persisted and replayed), so this fold is
 * equivalent to reading the editor's state, without lifting it.
 *
 * Semantics mirror `useSolverEstateEditor`'s own upsert/delete calls:
 *  - `value: null` → delete that id (no-op when the id is unknown)
 *  - `value: gift` → replace in place when the id exists, else append
 *  - later mutations win over earlier ones for the same id
 *
 * Keyed on the mutation's `id`, not `value.id` — `id` is the mutation's
 * identity (it is what `mutationKey` dedupes on), and it is what a delete
 * carries when there is no value to read an id from.
 *
 * Gifts toggled off (`enabled === false`) are RETAINED. `buildEstateFlowSummary`
 * and the projection each apply their own `enabled` filtering; dropping them
 * here would diverge from what the Techniques tab shows.
 */
export function deriveWorkingGifts(
  baseGifts: EstateFlowGift[],
  mutations: SolverMutation[],
): EstateFlowGift[] {
  // A Map preserves insertion order, and `set` on an existing key keeps that
  // key's original position — which is exactly the in-place-replace semantics
  // we want, with delete-then-re-add correctly landing at the end.
  const byId = new Map<string, EstateFlowGift>();
  for (const g of baseGifts) byId.set(g.id, g);

  for (const m of mutations) {
    if (m.kind !== "gift-upsert") continue;
    if (m.value === null) byId.delete(m.id);
    else byId.set(m.id, m.value);
  }

  return [...byId.values()];
}
