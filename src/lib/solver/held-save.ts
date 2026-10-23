// Held changes on their way to a save. Pure and client-safe (no db, no node:).
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { foldChanges } from "@/lib/scenario/fold-changes";
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
  const target = (c: { targetKind: string; targetId: string }) => `${c.targetKind}:${c.targetId}`;
  const added = new Set(held.filter((c) => c.opType === "add").map(target));
  if (added.size === 0) return { held, controls };

  const kept: SolverMutation[] = [];
  for (const control of controls) {
    const drafts = mutationsToScenarioChanges(treeWithHeld, clientId, [control]);
    const onAdds = drafts.filter((d) => added.has(target(d)));
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
