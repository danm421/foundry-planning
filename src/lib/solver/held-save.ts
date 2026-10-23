// Held changes on their way to a save. Pure and client-safe (no db, no node:).
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { foldChanges } from "@/lib/scenario/fold-changes";
import { targetKeyOf } from "@/lib/scenario/field-diff";
import { heldScenarioChanges, isHeldChange } from "./held-changes";
import { mutationsToScenarioChanges } from "./mutations-to-scenario-changes";
import { mutationKey, type SolverMutation } from "./types";

/**
 * Controls aimed at an item a held entry ADDS are folded into that add, so a
 * base insert (new uuid) and a scenario add carry the control's value.
 *
 * A control's drafts on held-added items fold in; the control stays in
 * `controls` unless every one of its drafts folded (a scale lever over a held
 * living expense and a base one still writes the base row). Its leftover write
 * on a held-added id is harmless: the base insert takes a fresh uuid, so an
 * update keyed by the synthetic id matches nothing.
 */
export function foldControlsIntoHeldAdds(
  treeWithHeld: ClientData,
  clientId: string,
  mutations: SolverMutation[],
): { held: ScenarioChange[]; controls: SolverMutation[] } {
  let held = heldScenarioChanges(mutations);
  const controls = mutations.filter((m) => !isHeldChange(m));
  const added = new Set(held.filter((c) => c.opType === "add").map(targetKeyOf));
  if (added.size === 0) return { held, controls };

  const kept: SolverMutation[] = [];
  for (const control of controls) {
    const drafts = mutationsToScenarioChanges(treeWithHeld, clientId, [control]);
    const onAdds = drafts.filter((d) => added.has(targetKeyOf(d)));
    held = foldChanges(
      held,
      onAdds.map((d, i) => ({
        ...d,
        id: `held-fold:${mutationKey(control)}:${i}`,
        scenarioId: "held",
        toggleGroupId: null,
      })),
    );
    if (onAdds.length < drafts.length || drafts.length === 0) kept.push(control);
  }
  return { held, controls: kept };
}

/** Every gift id a plan carries: a cash gift in `gifts`; an asset, business or
 *  recurring gift only through its events (`sourceGiftId` / `seriesId`); a QCD
 *  through `qcds`. */
function planGiftIds(tree: ClientData): Set<string> {
  const ids = new Set((tree.gifts ?? []).map((g) => g.id));
  for (const e of [...(tree.giftEvents ?? []), ...(tree.qcds ?? [])]) {
    const ref = e as { sourceGiftId?: string; seriesId?: string };
    if (ref.sourceGiftId) ids.add(ref.sourceGiftId);
    if (ref.seriesId) ids.add(ref.seriesId);
  }
  return ids;
}

/**
 * Items only the selected scenario has, which base has no row for: its adds,
 * and its gifts that base doesn't carry. A gift's add is also how a base gift
 * is edited, so gifts are matched by id against both plans instead. The
 * scenario's gifts are its tree's plus the editors' drafts (`sourceGifts`),
 * which read the scenario's own gift_series partition, whose rows have fresh ids.
 */
export function scenarioOnlyItemIds(args: {
  changes: readonly { opType: string; targetKind: string; targetId: string }[];
  sourceTree: ClientData;
  sourceGifts: readonly { id: string }[];
  baseTree: ClientData;
}): Set<string> {
  const inBase = planGiftIds(args.baseTree);
  const scenarioGifts = [...(args.sourceTree.gifts ?? []), ...args.sourceGifts].map((g) => g.id);
  return new Set([
    ...args.changes
      .filter((c) => c.opType === "add" && c.targetKind !== "gift")
      .map((c) => c.targetId),
    ...scenarioGifts.filter((id) => !inBase.has(id)),
  ]);
}
