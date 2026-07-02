import { describe, it, expect } from "vitest";
import { solveEducationDedicatedSavings } from "@/lib/solver/solve-education-dedicated-savings";
import type { ClientData, ProjectionYear } from "@/engine/types";

// A goal costing $10k/yr for years 2032..2033, funded by "acct".
// Fake runProjection: each $1/yr of contribution to "acct" from currentYear..lastDrawYear
// accumulates linearly (no growth) and offsets shortfall dollar-for-dollar.
function tree(): ClientData {
  return {
    expenses: [{
      id: "goal", type: "education", name: "G", annualAmount: 10_000,
      startYear: 2032, endYear: 2033, growthRate: 0, dedicatedAccountIds: ["acct"],
      payShortfallOutOfPocket: false,
    }],
    accounts: [{ id: "acct" }],
    savingsRules: [],
    incomes: [],
  } as unknown as ClientData;
}

// contribution years: 2026..2033 inclusive = 8 years. Total goal cost = 20_000.
// Available = 8 * annualContribution. Shortfall = max(0, 20_000 - available).
function fakeRun(currentYear: number): (t: ClientData) => ProjectionYear[] {
  return (t: ClientData) => {
    const rule = t.savingsRules.find((r) => r.accountId === "acct");
    const perYear = rule?.annualAmount ?? 0;
    const years = 2033 - currentYear + 1;
    const available = perYear * years;
    let remaining = Math.max(0, 20_000 - available);
    // Attribute all shortfall to a single goal-year row for simplicity.
    return [{ year: 2033, educationGoals: [{ goalId: "goal", shortfall: remaining } as never] } as never];
  };
}

describe("solveEducationDedicatedSavings", () => {
  it("returns 0 and fundsFully when already funded", () => {
    const t = tree();
    (t.savingsRules as unknown[]).push({ id: "r", accountId: "acct", annualAmount: 5_000, isDeductible: false, startYear: 2026, endYear: 2033 });
    const r = solveEducationDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(r.additionalAnnual).toBe(0);
    expect(r.fundsFully).toBe(true);
  });

  it("solves the additional level contribution to close the gap", () => {
    // No existing rule → needs 20_000 / 8 years = 2_500/yr.
    const r = solveEducationDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(r.fundsFully).toBe(true);
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
  });

  it("reports fundsFully=false when the source cannot close the gap under the cap", () => {
    const r = solveEducationDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026), cap: 1_000 });
    expect(r.fundsFully).toBe(false);
    expect(r.additionalAnnual).toBe(1_000);
  });
});
