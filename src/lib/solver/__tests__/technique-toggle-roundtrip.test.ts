// src/lib/solver/__tests__/technique-toggle-roundtrip.test.ts
//
// Round-trip test: the on/off toggle for solver techniques must survive the
// full save → reload path:
//   1. Disabling a base Roth conversion (enabled: false) produces a scenario
//      change/draft and, when replayed via applyScenarioChanges, yields an
//      effective tree whose rc-1 has enabled === false.
//   2. Re-enabling (enabled: undefined, identical to the base) produces NO
//      scenario diff — the normalization guarantee (no spurious edits).

import { describe, it, expect } from "vitest";
import type { ClientData, RothConversion } from "@/engine/types";
import type { TargetKind, ScenarioChange } from "@/engine/scenario/types";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";

const baseRc: RothConversion = {
  id: "rc-1",
  name: "Convert",
  destinationAccountId: "acct-roth",
  sourceAccountIds: ["acct-401k"],
  conversionType: "fixed_amount",
  fixedAmount: 25000,
  startYear: 2030,
  endYear: 2030,
  indexingRate: 0,
};

// Minimal source tree carrying one base Roth conversion.
function tree(): ClientData {
  return {
    client: {},
    planSettings: {},
    accounts: [],
    incomes: [],
    expenses: [],
    savingsRules: [],
    rothConversions: [baseRc],
  } as unknown as ClientData;
}

// Map SolverScenarioChangeDraft → ScenarioChange for applyScenarioChanges.
// Mirrors the canonical pattern from entity-roundtrip.test.ts.
function draftsToChanges(
  drafts: ReturnType<typeof mutationsToScenarioChanges>,
): ScenarioChange[] {
  return drafts.map((d, i) => ({
    id: `c${i}`,
    scenarioId: "s1",
    opType: d.opType,
    targetKind: d.targetKind as TargetKind,
    targetId: d.targetId,
    payload: d.payload,
    toggleGroupId: null,
    orderIndex: d.orderIndex,
  }));
}

describe("technique toggle survives a scenario save→reload", () => {
  it("disabling a base technique persists as enabled:false on reload", () => {
    const source = tree();

    const drafts = mutationsToScenarioChanges(source, "client-1", [
      {
        kind: "roth-conversion-upsert" as const,
        id: "rc-1",
        value: { ...baseRc, enabled: false },
      },
    ]);

    // Save: a draft for rc-1 must be emitted.
    const rothEdit = drafts.find(
      (d) => d.targetKind === "roth_conversion" && d.targetId === "rc-1",
    );
    expect(rothEdit).toBeTruthy();

    // Reload: replay the draft onto the base tree.
    const { effectiveTree } = applyScenarioChanges(
      structuredClone(source),
      draftsToChanges(drafts),
      {}, // no toggle overrides
      [], // no toggle groups
    );

    expect(
      effectiveTree.rothConversions?.find((r) => r.id === "rc-1")?.enabled,
    ).toBe(false);
  });

  it("re-enabling a base technique produces no scenario diff", () => {
    const source = tree();

    // value with enabled: undefined is identical to the base (no field diff).
    const drafts = mutationsToScenarioChanges(source, "client-1", [
      {
        kind: "roth-conversion-upsert" as const,
        id: "rc-1",
        value: { ...baseRc, enabled: undefined },
      },
    ]);

    // Normalization guarantee: re-enabling produces NO draft for rc-1.
    const rothChange = drafts.find(
      (d) => d.targetKind === "roth_conversion" && d.targetId === "rc-1",
    );
    expect(rothChange).toBeFalsy();
  });
});
