// src/lib/scenario/__tests__/loader-ref-resolution.test.ts
//
// Regression test for the solver "saved scenario projects identically to
// base" bug. A persisted scenario `client` edit that moves retirement age
// must reshift every milestone-anchored income/expense/savings year window:
// the engine reads only the concrete startYear/endYear and treats *YearRef as
// view metadata, so without re-resolution the reloaded scenario keeps the
// base-case windows and the projection never reflects the change.
//
// `applyScenarioChangesWithRefs` (the helper `loadEffectiveTree` delegates to)
// must run `resolveRefYears` after `applyScenarioChanges`.

import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";

// Birth year 1970, retirementAge 60 → client retires in 2030. A salary income
// anchored to `client_retirement` (a transition ref) ends the year prior:
// 2029. Bumping retirement to 67 → retires 2037 → salary should end 2036.
function baseTree(): ClientData {
  return {
    client: {
      id: "c1",
      dateOfBirth: "1970-06-15",
      retirementAge: 60,
      planEndAge: 95,
      spouseDob: null,
      spouseRetirementAge: null,
    },
    planSettings: { planStartYear: 2025, planEndYear: 2065 },
    accounts: [],
    incomes: [
      {
        id: "inc-salary",
        startYear: 2025,
        startYearRef: "plan_start",
        endYear: 2029,
        endYearRef: "client_retirement",
      },
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
  } as unknown as ClientData;
}

const retireLaterChange: ScenarioChange = {
  id: "ch1",
  scenarioId: "scn1",
  opType: "edit",
  targetKind: "client",
  targetId: "c1",
  payload: { retirementAge: { from: 60, to: 67 } },
  toggleGroupId: null,
  orderIndex: 0,
};

describe("applyScenarioChangesWithRefs — milestone re-resolution", () => {
  it("documents the gap: applyScenarioChanges alone leaves anchored windows stale", () => {
    const { effectiveTree } = applyScenarioChanges(
      baseTree(),
      [retireLaterChange],
      {},
      [],
    );
    expect(effectiveTree.client.retirementAge).toBe(67);
    // The salary still ends in 2029 — the age-60 retirement window. This is
    // the bug the loader fix must close.
    expect(effectiveTree.incomes[0].endYear).toBe(2029);
  });

  it("reshifts a retirement-anchored income endYear when the scenario edits retirement age", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [retireLaterChange],
      {},
      [],
    );
    expect(effectiveTree.client.retirementAge).toBe(67);
    // Retiring at 67 (born 1970) → retirement year 2037 → salary ends 2036.
    expect(effectiveTree.incomes[0].endYear).toBe(2036);
    // The plan_start-anchored startYear is unaffected.
    expect(effectiveTree.incomes[0].startYear).toBe(2025);
  });

  it("is a no-op when no scenario change moves a milestone", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(baseTree(), [], {}, []);
    expect(effectiveTree.incomes[0].endYear).toBe(2029);
  });
});

// "Last Year" (`plan_end`) is the year the LAST spouse dies, derived from the
// two life expectancies — `plan_settings.plan_end_year` is only a cache of it.
// A scenario whose stored horizon lags its life expectancies must still end at
// the survivor's death, and every plan_end-anchored row must follow.
describe("applyScenarioChangesWithRefs — plan horizon follows life expectancy", () => {
  it("re-derives a stale planEndYear from the survivor's life expectancy", () => {
    const tree = baseTree();
    // Client 1970 + 95 → 2065; spouse 1975 + 95 → 2070. Stored horizon is
    // stuck at the client's own death, as if the spouse were never counted.
    tree.client = {
      ...tree.client,
      lifeExpectancy: 95,
      spouseDob: "1975-03-01",
      spouseLifeExpectancy: 95,
    };
    tree.expenses = [
      {
        id: "exp-living",
        startYear: 2025,
        startYearRef: "plan_start",
        endYear: 2065,
        endYearRef: "plan_end",
      },
    ] as unknown as ClientData["expenses"];

    const { effectiveTree } = applyScenarioChangesWithRefs(tree, [], {}, []);

    expect(effectiveTree.planSettings.planEndYear).toBe(2070);
    expect(effectiveTree.client.planEndAge).toBe(100);
    expect(effectiveTree.expenses[0].endYear).toBe(2070);
  });
});
