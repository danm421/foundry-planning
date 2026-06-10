// src/lib/scenario/normalize-scenario-gifts.ts
//
// Approach A (additive merge) for solver-saved planned gifts. A scenario `gift`
// overlay row carries an `EstateFlowGift` draft; applyScenarioChanges appends it
// to `tree.gifts` (typed Gift[]) without rebuilding the engine's derived
// `giftEvents`. This helper partitions those draft entries out, runs them through
// the same `applyGiftsToClientData` bridge the live solver uses, and APPENDS the
// derived gifts/giftEvents to the base tree's — so a saved scenario projects
// identically to its live preview. Pure; never mutates `tree`.

import type { ClientData, Gift } from "@/engine/types";
import {
  applyGiftsToClientData,
  type EstateFlowGift,
} from "@/lib/estate/estate-flow-gifts";

/** A draft-shaped gift entry (vs a base `Gift` row). Base `Gift` never carries a
 *  `kind` field; every `EstateFlowGift` always does. */
export function isEstateFlowGiftDraft(g: unknown): g is EstateFlowGift {
  if (typeof g !== "object" || g === null || !("kind" in g)) return false;
  const k = (g as { kind: unknown }).kind;
  return k === "cash-once" || k === "asset-once" || k === "series";
}

export function normalizeScenarioGifts(tree: ClientData, cpi: number): ClientData {
  const all = (tree.gifts ?? []) as unknown[];
  const drafts = all.filter(isEstateFlowGiftDraft);
  if (drafts.length === 0) return tree;

  const baseGifts = all.filter((g) => !isEstateFlowGiftDraft(g)) as Gift[];
  const derived = applyGiftsToClientData(
    { ...tree, gifts: [], giftEvents: [] },
    drafts,
    cpi,
  );
  return {
    ...tree,
    gifts: [...baseGifts, ...(derived.gifts ?? [])],
    giftEvents: [...(tree.giftEvents ?? []), ...(derived.giftEvents ?? [])].sort(
      (a, b) => a.year - b.year,
    ),
  };
}
