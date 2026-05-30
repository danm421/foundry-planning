// src/lib/solver/__tests__/solve-funding.test.ts
import { describe, it, expect } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { solveFunding } from "../solve-funding";

// A fake tree + projector: funding improves as the savings lever rises.
// We bypass the real engine by injecting `project`.
function fakeYear(liquid: number): ProjectionYear {
  return {
    year: 2040,
    ages: { client: 65 },
    income: { total: 0 } as ProjectionYear["income"],
    withdrawals: { total: 0, byAccount: {} },
    totalIncome: 0,
    totalExpenses: 100,
    netCashFlow: -100,
    portfolioAssets: { taxableTotal: liquid, cashTotal: 0, retirementTotal: 0 } as ProjectionYear["portfolioAssets"],
  } as ProjectionYear;
}

describe("solveFunding", () => {
  it("converges to the minimum savings that reaches full funding", async () => {
    const tree = {} as ClientData;
    const result = await solveFunding({
      effectiveTree: tree,
      baselineMutations: [],
      target: { kind: "savings-contribution", accountId: "acct-1" },
      // Inject a deterministic projector: liquid = value/1000 - 30 (full at >= 30000).
      project: (value) => [fakeYear(value / 1000 - 30)],
      leverConfigOverride: { lo: 0, hi: 60000, step: 1000, direction: 1 },
    });
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBeGreaterThanOrEqual(30000);
    expect(result.solvedValue).toBeLessThanOrEqual(31000);
    expect(result.finalProjection.length).toBe(1);
  });

  it("narrows to the minimal funded lever value over multiple iterations", async () => {
    const tree = {} as ClientData;
    // Funded boundary at 21000 (odd, not a first-midpoint): liquid >= 0 iff value >= 21000.
    const result = await solveFunding({
      effectiveTree: tree,
      baselineMutations: [],
      target: { kind: "savings-contribution", accountId: "acct-1" },
      project: (value) => [fakeYear(value - 21000)],
      leverConfigOverride: { lo: 0, hi: 60000, step: 1000, direction: 1 },
    });
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(21000); // minimal funded step
    // The returned projection must actually be funded.
    expect(result.finalProjection.every((y) => y.portfolioAssets.taxableTotal >= 0)).toBe(true);
  });
});
