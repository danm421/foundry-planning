import { describe, it, expect } from "vitest";
import { defaultAssumptions } from "../settings";
import type { ClientData } from "@/engine/types";

// NOTE: `ClientData["planSettings"]` is `PlanSettings`, which carries plan-year
// and tax-rate fields only. The model-portfolio fields (modelPortfolioIdRetirement,
// defaultGrowthLifeInsurance, etc.) live on the DB `client_plan_settings` table but
// are NOT projected through to the engine's PlanSettings interface. As a result,
// `defaultAssumptions` cannot read a portfolio from `data.planSettings` and defaults
// `modelPortfolioId` to `null`. The user sets it explicitly via the UI after creation.
function fakeData(over: Partial<ClientData["planSettings"]> = {}): ClientData {
  return {
    planSettings: {
      planStartYear: 2026,
      planEndYear: 2060,
      estateAdminExpenses: 25_000,
      flatFederalRate: 0.24,
      flatStateRate: 0.05,
      inflationRate: 0.03,
      ...over,
    },
  } as unknown as ClientData;
}

describe("defaultAssumptions", () => {
  it("returns the new shape without deprecated fields", () => {
    const a = defaultAssumptions(fakeData());
    expect(a).not.toHaveProperty("growthRate");
    expect(a).not.toHaveProperty("finalExpenses");
    expect(a).not.toHaveProperty("payOffDebtsAtDeath");
  });

  it("defaults modelPortfolioId to null (not available on PlanSettings)", () => {
    const a = defaultAssumptions(fakeData());
    expect(a.modelPortfolioId).toBeNull();
  });

  it("defaults payoffLiabilityIds to empty array", () => {
    const a = defaultAssumptions(fakeData());
    expect(a.payoffLiabilityIds).toEqual([]);
  });

  it("sets deathYear to planStartYear + 1", () => {
    const a = defaultAssumptions(fakeData({ planStartYear: 2030 }));
    expect(a.deathYear).toBe(2031);
  });

  it("defaults mcTargetScore to 0.9", () => {
    const a = defaultAssumptions(fakeData());
    expect(a.mcTargetScore).toBe(0.9);
  });

  it("defaults leaveToHeirsAmount to 0", () => {
    const a = defaultAssumptions(fakeData());
    expect(a.leaveToHeirsAmount).toBe(0);
  });

  it("defaults livingExpenseAtDeath to null", () => {
    const a = defaultAssumptions(fakeData());
    expect(a.livingExpenseAtDeath).toBeNull();
  });

  it("defaults coverEstateTaxes to false", () => {
    const a = defaultAssumptions(fakeData());
    expect(a.coverEstateTaxes).toBe(false);
  });
});
