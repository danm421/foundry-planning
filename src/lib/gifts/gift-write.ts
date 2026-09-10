//
// Scenario-mode payload builders for gift writes.
//
// Gifts have NO `edit` op. The gift overlay reloads by strip-and-rematerialise:
// `partitionGiftChanges` puts EVERY change's targetId into `targeted` (which
// removes the base row) but re-materialises ONLY `add` payloads
// (apply-gift-overlays.ts:37-43). So an `edit` row deletes the gift and puts
// nothing back. A save — new gift or edit of an existing one — is always an
// `add` carrying the full draft; `applyEntityAdd` records `targetId: entity.id`
// (changes-writer.ts:334), so re-using the existing id is what replaces the base
// row rather than duplicating it. Same rule as the solver:
// mutations-to-scenario-changes.ts:596-607.

import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";

/** Scenario payload for a gift save. Used for BOTH create and edit — see above. */
export function giftScenarioAdd(draft: EstateFlowGift): ScenarioEdit {
  return {
    op: "add",
    targetKind: "gift",
    entity: draft as unknown as Record<string, unknown>,
  };
}

/** Scenario payload for a gift delete. */
export function giftScenarioRemove(id: string): ScenarioEdit {
  return { op: "remove", targetKind: "gift", targetId: id };
}

/**
 * Guard the gift types the overlay cannot carry. `giftRowToDraft` returns null
 * for business-interest and liability gifts (estate-flow-gifts.ts:142-144).
 * Falling back to a base write there would silently mutate the base plan from
 * inside a scenario — the exact bug this work removes — so fail loudly instead.
 */
export function assertDraftable(
  draft: EstateFlowGift | null,
  context: string,
): EstateFlowGift {
  if (draft === null) {
    throw new Error(
      `This ${context} cannot be saved into a scenario yet. Switch to the base plan to edit it.`,
    );
  }
  return draft;
}
