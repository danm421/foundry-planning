// src/lib/scenario/apply-gift-overlays.ts
//
// Reload-side counterpart to apply-mutations.ts's gift handling. Given the
// scenario's `gift` changes, strips each targeted gift's existing footprint
// (base or prior) from tree.gifts/giftEvents and re-materialises `add` payload
// drafts via the same applyGiftsToClientData bridge the live solver uses — so a
// saved scenario projects identically to its live preview, for edits/removes/
// toggles of base gifts as well as net-new adds. Pure; never mutates `tree`.

import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import {
  applyGiftsToClientData,
  giftEventBelongsTo,
  type EstateFlowGift,
} from "@/lib/estate/estate-flow-gifts";

/** A draft-shaped gift entry (vs a base `Gift` row). Base `Gift` never carries a
 *  `kind` field; every `EstateFlowGift` always does. */
export function isEstateFlowGiftDraft(g: unknown): g is EstateFlowGift {
  if (typeof g !== "object" || g === null || !("kind" in g)) return false;
  const k = (g as { kind: unknown }).kind;
  return k === "cash-once" || k === "asset-once" || k === "series";
}

export function applyGiftOverlays(
  tree: ClientData,
  giftChanges: ScenarioChange[],
  cpi: number,
): ClientData {
  if (giftChanges.length === 0) return tree;

  const targeted = new Set(giftChanges.map((c) => c.targetId));
  const addDrafts = giftChanges
    .filter((c) => c.opType === "add")
    .map((c) => c.payload)
    .filter(isEstateFlowGiftDraft);

  const keptGifts = (tree.gifts ?? []).filter((g) => !targeted.has(g.id));
  const keptEvents = (tree.giftEvents ?? []).filter(
    (e) => !giftEventBelongsTo(e, targeted),
  );
  const derived = applyGiftsToClientData(
    { ...tree, gifts: [], giftEvents: [] },
    addDrafts,
    cpi,
  );
  return {
    ...tree,
    gifts: [...keptGifts, ...(derived.gifts ?? [])],
    giftEvents: [...keptEvents, ...derived.giftEvents].sort(
      (a, b) => a.year - b.year,
    ),
  };
}
