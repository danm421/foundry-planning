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

/**
 * Refuse a past-dated ASSET transfer recorded inside a scenario.
 *
 * `POST /gifts` dual-writes `account_owners` / `liability_owners` when the gift
 * year is before the plan's start year, because the engine never replays an
 * event from before the projection begins (gifts/route.ts). A scenario bypasses
 * that route, and the overlay only produces a `GiftEvent` at the past year —
 * which the engine ignores. The save succeeds, the row appears in the list, and
 * NOT ONE NUMBER MOVES: the account still reads 100% household-owned. The same
 * save on the base plan moves the ownership. An advisor reads that as a dead
 * Save button.
 *
 * Teaching the overlay to represent past-dated ownership is the pre-existing
 * "owners are the authored baseline, gifts are an overlay" problem, and is not
 * this guard's job. Saying so out loud is.
 *
 * The rule mirrors the server's exactly, including its narrowness: only an
 * asset transfer TO AN ENTITY triggers the dual-write, so only that shape is
 * refused. `planStartYear` must be the plan's REAL start year — a calendar-year
 * guess is not the rule the server applies, so an unknown value refuses
 * nothing rather than blocking a legal save on a guess.
 */
export function assertNotPastDatedAssetGift(
  draft: EstateFlowGift,
  opts: { scenarioActive: boolean; planStartYear: number | null | undefined },
): void {
  if (!opts.scenarioActive) return;
  if (draft.kind !== "asset-once") return;
  if (draft.recipient.kind !== "entity") return;
  const start = opts.planStartYear;
  if (start == null || draft.year >= start) return;
  throw new Error(
    `This transfer is dated ${draft.year}, before the plan starts in ${start}. ` +
      `A scenario cannot record a transfer of ownership that has already happened — ` +
      `saving it here would change no numbers at all. Switch to the base plan to record it.`,
  );
}
