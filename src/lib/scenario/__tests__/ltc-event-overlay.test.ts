import { describe, it, expect } from "vitest";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { scenarioChangesToBaseWrites } from "../scenario-changes-to-base-writes";
import { SCENARIO_ONLY_KINDS } from "../promote-table-registry";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { ScenarioChange } from "@/engine/scenario/types";

const event = {
  id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566",
  name: "Long-term care — John 85–87",
  people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
  livingExpenseCutPct: 1,
  homeSale: null,
  includePolicies: true,
};
const change: ScenarioChange = {
  id: "c1", scenarioId: "s1", opType: "add", targetKind: "ltc_event",
  targetId: event.id, payload: event, toggleGroupId: null, orderIndex: 0,
} as ScenarioChange;

describe("ltc_event overlay", () => {
  it("an add puts the event on tree.ltcEvents", () => {
    const { effectiveTree } = applyScenarioChanges(buildClientData(), [change], {}, []);
    expect(effectiveTree.ltcEvents).toEqual([event]);
  });

  it("is scenario-only", () => {
    expect(SCENARIO_ONLY_KINDS.has("ltc_event")).toBe(true);
  });

  it("promote-to-base writes nothing for it", () => {
    const plan = scenarioChangesToBaseWrites(buildClientData(), [change], [], {});
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.removes).toEqual([]);
  });
});
