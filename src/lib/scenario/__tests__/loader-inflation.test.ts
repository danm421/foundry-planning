// Regression test for "re-resolve base entities under scenario-edited
// plan_settings" at the loader seam.
//
// `applyScenarioChangesWithRefs` must re-resolve inflation-driven growth over
// the effective tree when a scenario edits `plan_settings.inflationRate`, using
// the inflation inputs + account id sets threaded on the resolution context.

import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";

function makeCtx(baseRate: number): ResolutionContext {
  return {
    resolver: {} as unknown as ResolutionContext["resolver"],
    resolvedInflationRate: baseRate,
    resolvedInflationInputs: {
      inflationRateSource: "custom",
      inflationClass: null,
      clientOverride: null,
    },
    accountGrowthFromInflation: new Set(["re1"]),
    accountPropertyTaxFromInflation: new Set(),
  };
}

function baseTree(): ClientData {
  return {
    client: { dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 95, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2025, planEndYear: 2065, inflationRate: 0.03 },
    accounts: [
      { id: "re1", category: "real_estate", growthRate: 0.03, propertyTaxGrowthRate: 0, owners: [] },
    ],
    incomes: [
      { id: "inc1", growthSource: "inflation", growthRate: 0.03, startYear: 2026, endYear: 2060 },
    ],
    expenses: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
    reinvestments: [],
  } as unknown as ClientData;
}

function editInflationChange(to: number): ScenarioChange {
  return {
    id: "ch1",
    scenarioId: "scn1",
    opType: "edit",
    targetKind: "plan_settings",
    targetId: "plan_settings",
    payload: { inflationRate: { from: 0.03, to } },
    toggleGroupId: null,
    orderIndex: 0,
  };
}

describe("applyScenarioChangesWithRefs — base-entity inflation re-resolution", () => {
  it("re-resolves inflation-sourced base entities when a scenario edits the inflation rate", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [editInflationChange(0.05)],
      {},
      [],
      makeCtx(0.03),
    );
    expect(effectiveTree.planSettings.inflationRate).toBeCloseTo(0.05);
    expect(effectiveTree.incomes[0].growthRate).toBeCloseTo(0.05);
    expect(effectiveTree.accounts.find((a) => a.id === "re1")!.growthRate).toBeCloseTo(0.05);
  });

  it("leaves base-entity growth unchanged when no scenario inflation edit is present", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [],
      {},
      [],
      makeCtx(0.03),
    );
    expect(effectiveTree.incomes[0].growthRate).toBeCloseTo(0.03);
    expect(effectiveTree.accounts.find((a) => a.id === "re1")!.growthRate).toBeCloseTo(0.03);
  });
});
