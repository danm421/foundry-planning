import { describe, it, expect } from "vitest";
import { applyScenarioChanges } from "../applyChanges";
import type { ClientData } from "../../types";
import type { ScenarioChange } from "../types";

function baseTree(): ClientData {
  // Minimal tree — only the fields applyScenarioChanges touches need to exist.
  return { relocations: [] } as unknown as ClientData;
}

describe("applyScenarioChanges — relocation", () => {
  it("adds a relocation row to tree.relocations", () => {
    const change: ScenarioChange = {
      id: "c1", scenarioId: "s1", opType: "add", targetKind: "relocation",
      targetId: "r1",
      payload: { id: "r1", name: "Move to FL", year: 2030, destinationState: "FL" },
      toggleGroupId: null, orderIndex: 0,
    };
    const { effectiveTree } = applyScenarioChanges(baseTree(), [change], {}, []);
    expect(effectiveTree.relocations).toHaveLength(1);
    expect(effectiveTree.relocations![0]).toMatchObject({ destinationState: "FL", year: 2030 });
  });

  it("edits and removes a relocation row", () => {
    const tree = baseTree();
    tree.relocations = [{ id: "r1", name: "Move to FL", year: 2030, destinationState: "FL" }];
    const edit: ScenarioChange = {
      id: "c2", scenarioId: "s1", opType: "edit", targetKind: "relocation", targetId: "r1",
      payload: { year: { from: 2030, to: 2035 } }, toggleGroupId: null, orderIndex: 0,
    };
    const edited = applyScenarioChanges(tree, [edit], {}, []).effectiveTree;
    expect(edited.relocations![0].year).toBe(2035);

    const remove: ScenarioChange = {
      id: "c3", scenarioId: "s1", opType: "remove", targetKind: "relocation", targetId: "r1",
      payload: null, toggleGroupId: null, orderIndex: 0,
    };
    const removed = applyScenarioChanges(baseTree(), [remove], {}, []).effectiveTree;
    expect(removed.relocations ?? []).toHaveLength(0);
  });
});
