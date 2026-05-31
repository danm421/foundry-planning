// Regression test for "re-resolve base entities under scenario-edited
// plan_settings".
//
// Base accounts/incomes/expenses/savings have their growthRate resolved at
// base-load time using the plan's inflation rate. A scenario that edits the
// inflation rate updates `effectiveTree.planSettings.inflationRate`, but the
// already-resolved base-entity growth rates sat stale on the pre-resolved tree.
//
// The resolver itself is invariant under a scenario (CMA / model-portfolio /
// category fields aren't on the scenario-editable `EnginePlanSettings`), so the
// only resolution input a scenario changes is the resolved inflation rate.
// `reResolveInflationGrowth` recomputes that rate from the effective plan
// settings and re-applies it to every inflation-sourced entity.

import { describe, it, expect } from "vitest";
import { reResolveInflationGrowth } from "../resolve-inflation-growth";
import type { ResolutionContext } from "../resolve-entity";
import type { ClientData } from "@/engine/types";

function ctx(baseRate: number): ResolutionContext {
  return {
    // resolver is unused by inflation re-resolution.
    resolver: {} as unknown as ResolutionContext["resolver"],
    resolvedInflationRate: baseRate,
    resolvedInflationInputs: {
      inflationRateSource: "custom",
      inflationClass: null,
      clientOverride: null,
    },
    accountGrowthFromInflation: new Set(["re1"]),
    accountPropertyTaxFromInflation: new Set(["re1"]),
  };
}

function tree(inflationRate: number): ClientData {
  return {
    planSettings: { inflationRate },
    accounts: [
      { id: "re1", category: "real_estate", growthRate: 0.03, propertyTaxGrowthRate: 0.03 },
      { id: "br1", category: "taxable", growthRate: 0.08, propertyTaxGrowthRate: 0 },
    ],
    incomes: [
      { id: "inc-infl", growthSource: "inflation", growthRate: 0.03 },
      { id: "inc-custom", growthSource: "custom", growthRate: 0.06 },
    ],
    expenses: [{ id: "exp-infl", growthSource: "inflation", growthRate: 0.03 }],
    savingsRules: [{ id: "sav-infl", growthSource: "inflation", growthRate: 0.03 }],
  } as unknown as ClientData;
}

describe("reResolveInflationGrowth", () => {
  it("bumps inflation-sourced growth rates to the new resolved inflation rate", () => {
    const result = reResolveInflationGrowth(tree(0.05), ctx(0.03));
    expect(result.incomes.find((i) => i.id === "inc-infl")!.growthRate).toBeCloseTo(0.05);
    expect(result.expenses[0].growthRate).toBeCloseTo(0.05);
    expect(result.savingsRules[0].growthRate).toBeCloseTo(0.05);
    const re = result.accounts.find((a) => a.id === "re1")!;
    expect(re.growthRate).toBeCloseTo(0.05);
    expect(re.propertyTaxGrowthRate).toBeCloseTo(0.05);
  });

  it("leaves custom-sourced entities and non-inflation accounts untouched", () => {
    const result = reResolveInflationGrowth(tree(0.05), ctx(0.03));
    expect(result.incomes.find((i) => i.id === "inc-custom")!.growthRate).toBeCloseTo(0.06);
    expect(result.accounts.find((a) => a.id === "br1")!.growthRate).toBeCloseTo(0.08);
  });

  it("returns the same tree reference when the resolved inflation rate is unchanged", () => {
    const t = tree(0.03);
    expect(reResolveInflationGrowth(t, ctx(0.03))).toBe(t);
  });

  it("no-ops when the context carries no inflation inputs", () => {
    const t = tree(0.05);
    const bareCtx = {
      resolver: {} as unknown as ResolutionContext["resolver"],
      resolvedInflationRate: 0.03,
    } as ResolutionContext;
    expect(reResolveInflationGrowth(t, bareCtx)).toBe(t);
  });
});
