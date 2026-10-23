import "server-only";
// What an editor opened from the Solver must show on top of the starting plan:
// the held editor changes plus the switched-on controls (steppers, sliders),
// both in scenario-change form. The Details loaders fold these over the saved
// changes (`loadEffectiveTree`'s `extraChanges`).
import type { ScenarioChange } from "@/engine/scenario/types";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { foldChanges } from "@/lib/scenario/fold-changes";
import { heldScenarioChanges, isHeldChange } from "./held-changes";
import { mutationsToScenarioChanges } from "./mutations-to-scenario-changes";
import type { SolverMutation } from "./types";

export async function editorExtraChanges(
  clientId: string,
  firmId: string,
  source: "base" | string,
  mutations: SolverMutation[],
): Promise<ScenarioChange[]> {
  if (mutations.length === 0) return [];
  const held = heldScenarioChanges(mutations);
  const controls = mutations.filter((m) => !isHeldChange(m));
  // Controls diff against the tree as held changes leave it, so a stepper moved
  // after a dialog edit folds onto that edit.
  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, source, {}, held);
  const leverChanges: ScenarioChange[] = mutationsToScenarioChanges(effectiveTree, clientId, controls).map(
    (d, i) => ({
      id: "lever:" + i,
      scenarioId: "held",
      opType: d.opType,
      targetKind: d.targetKind,
      targetId: d.targetId,
      payload: d.payload,
      toggleGroupId: null,
      orderIndex: d.orderIndex,
    }),
  );
  return foldChanges(held, leverChanges);
}
