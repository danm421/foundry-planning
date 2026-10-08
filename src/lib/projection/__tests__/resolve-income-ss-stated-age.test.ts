// src/lib/projection/__tests__/resolve-income-ss-stated-age.test.ts
import { describe, it, expect } from "vitest";
import { resolveIncomeFromRaw } from "@/lib/projection/resolve-entity";
import { incomeEngineToView } from "@/lib/scenario/view-adapters";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { ClientData } from "@/engine/types";

const ctx = { resolvedInflationRate: 0.03 } as Parameters<typeof resolveIncomeFromRaw>[1];
const raw = {
  id: "i1", type: "social_security", name: "SS", annualAmount: "68478.00",
  startYear: 2026, endYear: 2099, growthSource: "custom", growthRate: "0.02",
  owner: "client", claimingAge: 70, ssBenefitMode: "manual_amount",
  ssStatedAge: 70, ssStatedAgeMonths: 0, ssAmountUnit: "monthly",
};

describe("stated age + unit reach the engine row and back", () => {
  it("resolveIncomeFromRaw carries all three", () => {
    const inc = resolveIncomeFromRaw(raw, ctx);
    expect(inc.ssStatedAge).toBe(70);
    expect(inc.ssStatedAgeMonths).toBe(0);
    expect(inc.ssAmountUnit).toBe("monthly");
  });

  it("absent columns read as null, not undefined-typed garbage", () => {
    const { ssStatedAge, ssStatedAgeMonths, ssAmountUnit, ...legacy } = raw;
    void ssStatedAge; void ssStatedAgeMonths; void ssAmountUnit;
    const inc = resolveIncomeFromRaw(legacy, ctx);
    expect(inc.ssStatedAge).toBeNull();
    expect(inc.ssAmountUnit).toBeNull();
  });

  it("the scenario view round-trips them (a form hydrated from it must not clear them on save)", () => {
    const view = incomeEngineToView(resolveIncomeFromRaw(raw, ctx));
    expect(view.ssStatedAge).toBe(70);
    expect(view.ssStatedAgeMonths).toBe(0);
    expect(view.ssAmountUnit).toBe("monthly");
  });

  it("a scenario edit storing the ages as strings reaches the engine as numbers", () => {
    // Scenario overlays store edited values as the form posted them (strings).
    const base = {
      incomes: [resolveIncomeFromRaw(raw, ctx)],
      planSettings: {},
    } as unknown as ClientData;
    const change: ScenarioChange = {
      id: "ch1",
      scenarioId: "s1",
      opType: "edit",
      targetKind: "income",
      targetId: "i1",
      payload: {
        ssStatedAge: { from: 70, to: "68" },
        ssStatedAgeMonths: { from: 0, to: "6" },
      },
      toggleGroupId: null,
      orderIndex: 0,
    };

    const inc = applyScenarioChanges(base, [change], {}, []).effectiveTree.incomes[0];
    expect(inc.ssStatedAge).toBe(68);
    expect(inc.ssStatedAgeMonths).toBe(6);
  });
});
