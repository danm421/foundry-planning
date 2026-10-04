import { describe, it, expect } from "vitest";
import { scenarioChangesToBaseWrites } from "../scenario-changes-to-base-writes";
import { SCENARIO_ONLY_KINDS } from "../promote-table-registry";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";

describe("promote — stress_test is scenario-only", () => {
  it("is registered as scenario-only", () => {
    expect(SCENARIO_ONLY_KINDS.has("stress_test")).toBe(true);
  });

  it("promoting a scenario that holds a market crash writes nothing to the base plan", () => {
    const id = STRESS_TEST_IDS["market-crash"];
    const plan = scenarioChangesToBaseWrites(
      buildClientData(),
      [{
        id: "chg-1", scenarioId: "s1", opType: "add", targetKind: "stress_test", targetId: id,
        payload: { kind: "market-crash", year: 2027, drawdownPct: 0.3, id, name: "Market crash — 30% in 2027" },
        toggleGroupId: null, orderIndex: 0,
      }],
      [],
      {},
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.singletonUpdates).toEqual([]);
    expect(plan.removes).toEqual([]);
  });
});
