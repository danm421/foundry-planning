import { describe, it, expect } from "vitest";
import { buildScenarioChangesData } from "../view-model";
import { SCENARIO_CHANGES_OPTIONS_DEFAULT } from "../options-schema";
import type { ScenarioChange } from "@/engine/scenario/types";

function ch(p: Partial<ScenarioChange>): ScenarioChange {
  return { id: "c", scenarioId: "s", opType: "edit", targetKind: "income", targetId: "i1",
    payload: {}, toggleGroupId: null, orderIndex: 0, ...p };
}

describe("buildScenarioChangesData", () => {
  it("returns the empty state when no context is injected", () => {
    const data = buildScenarioChangesData(undefined, SCENARIO_CHANGES_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(true);
    expect(data.units).toEqual([]);
  });

  it("returns the empty state when the scenario has no changes", () => {
    const data = buildScenarioChangesData(
      { changes: [], toggleGroups: [], targetNames: {}, baseLabel: "your current plan" },
      SCENARIO_CHANGES_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(true);
  });

  it("describes and groups changes", () => {
    const data = buildScenarioChangesData(
      {
        changes: [
          ch({ id: "a", targetKind: "income", targetId: "i1", opType: "add", payload: {}, orderIndex: 1 }),
          ch({ id: "b", targetKind: "entity", targetId: "e1", opType: "add", payload: {}, toggleGroupId: "g1", orderIndex: 2 }),
        ],
        toggleGroups: [{ id: "g1", scenarioId: "s", name: "IDGT sale", defaultOn: true, requiresGroupId: null, orderIndex: 0 }],
        targetNames: { "income:i1": "Rental income", "entity:e1": "IDGT" },
        baseLabel: "your current plan",
      },
      SCENARIO_CHANGES_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(false);
    expect(data.subtitle).toBe("What's different from your current plan");
    expect(data.units.some((u) => u.kind === "group" && u.label === "IDGT sale")).toBe(true);
  });
});
