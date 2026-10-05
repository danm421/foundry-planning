import { describe, it, expect } from "vitest";
import { solveGoalDedicatedSavings } from "@/lib/solver/solve-goal-dedicated-savings";
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
    const remaining = Math.max(0, 20_000 - available);
    // Attribute the whole cost + shortfall to a single goal-year row for simplicity.
    return [{ year: 2033, goals: [{ goalId: "goal", goalExpense: 20_000, dedicatedWithdrawal: 20_000 - remaining, outOfPocketWithdrawal: 0, shortfall: remaining } as never] } as never];
  };
}

describe("solveGoalDedicatedSavings", () => {
  it("returns 0 and reachesTarget when already funded", () => {
    const t = tree();
    (t.savingsRules as unknown[]).push({ id: "r", accountId: "acct", annualAmount: 5_000, isDeductible: false, startYear: 2026, endYear: 2033 });
    const r = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(r.additionalAnnual).toBe(0);
    expect(r.reachesTarget).toBe(true);
    expect(r.targetPct).toBe(1); // defaults to funding the goal in full
  });

  it("solves the additional level contribution to close the gap", () => {
    // No existing rule → needs 20_000 / 8 years = 2_500/yr.
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(r.reachesTarget).toBe(true);
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
  });

  it("solves to a PARTIAL target — 60% of a 20k goal needs 60% of the contribution", () => {
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026), targetPct: 0.6 });
    expect(r.reachesTarget).toBe(true);
    expect(r.targetPct).toBe(0.6);
    // 12_000 of the 20_000 cost over 8 years = 1_500/yr, well under the 2_500 a
    // full solve asks for — the remaining 8_000 is a deliberate shortfall.
    expect(Math.abs(r.additionalAnnual - 1_500)).toBeLessThanOrEqual(50);
  });

  it("a partial target is already met by a contribution too small to fund the goal fully", () => {
    const t = tree();
    // 2_000/yr × 8 = 16_000 of 20_000 → 80% funded: short of 100%, past 75%.
    (t.savingsRules as unknown[]).push({ id: "r", accountId: "acct", annualAmount: 2_000, isDeductible: false, startYear: 2026, endYear: 2033 });
    const partial = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026), targetPct: 0.75 });
    expect(partial.additionalAnnual).toBe(0);
    const full = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(full.additionalAnnual).toBeGreaterThan(0);
  });

  it("reports reachesTarget=false when the source cannot close the gap under the cap", () => {
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026), cap: 1_000 });
    expect(r.reachesTarget).toBe(false);
    expect(r.additionalAnnual).toBe(1_000);
  });
  it("sizes the savings even when cash flow pays the gap (Decision 7)", () => {
    // Same savings picture, but the goal pays its gap from cash flow: shortfall
    // is 0 while the savings still leave `remaining` uncovered.
    const coveredRun = (currentYear: number) => (t: ClientData) => {
      const rule = t.savingsRules.find((r) => r.accountId === "acct");
      const available = (rule?.annualAmount ?? 0) * (2033 - currentYear + 1);
      const remaining = Math.max(0, 20_000 - available);
      return [{ year: 2033, goals: [{ goalId: "goal", goalExpense: 20_000, dedicatedWithdrawal: 20_000 - remaining, outOfPocketWithdrawal: remaining, shortfall: 0 } as never] } as never];
    };
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: coveredRun(2026) });
    expect(r.reachesTarget).toBe(true);
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
  });

  it("solves an Other goal the same way", () => {
    const t = tree();
    (t.expenses as unknown as Record<string, unknown>[])[0] = {
      ...(t.expenses[0] as unknown as Record<string, unknown>), type: "other", isGoal: true,
    };
    const r = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
  });
});
