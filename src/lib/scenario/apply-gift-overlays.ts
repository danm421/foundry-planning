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

/**
 * The two things every gift overlay needs out of a scenario's `gift` changes:
 * which gift ids it targets (their existing footprint is stripped, whether the
 * change edits or removes them) and the draft payloads to re-materialise. The
 * three overlays below differ only in what they do with these — tree, drafts,
 * or DB rows — so the rule itself lives here once.
 */
export function partitionGiftChanges(changes: ScenarioChange[]): {
  targeted: Set<string>;
  adds: EstateFlowGift[];
} {
  return {
    targeted: new Set(changes.map((c) => c.targetId)),
    adds: changes
      .filter((c) => c.opType === "add")
      .map((c) => c.payload)
      .filter(isEstateFlowGiftDraft),
  };
}

export function applyGiftOverlays(
  tree: ClientData,
  giftChanges: ScenarioChange[],
  cpi: number,
): ClientData {
  if (giftChanges.length === 0) return tree;

  const { targeted, adds: addDrafts } = partitionGiftChanges(giftChanges);

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

/**
 * Draft-level counterpart to `applyGiftOverlays`. Same strip-and-rematerialise
 * rule, applied to the `EstateFlowGift[]` list the *editors* render (solver
 * estate tab, estate-flow editor, Details → Profile) rather than to the
 * projection tree: every targeted id loses its base draft, then each `add`
 * payload is appended. Keeping the two on one rule is what makes an editor's
 * gift list agree with the numbers the same scenario projects.
 */
export function overlayGiftDrafts(
  base: EstateFlowGift[],
  giftChanges: ScenarioChange[],
): EstateFlowGift[] {
  if (giftChanges.length === 0) return base;
  const { targeted, adds } = partitionGiftChanges(giftChanges);
  return [...base.filter((g) => !targeted.has(g.id)), ...adds];
}
