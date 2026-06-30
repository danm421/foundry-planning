// src/lib/solver/__tests__/solve-target-refine.test.ts
//
// solveTarget's living-expense-scale (max-spend) solve must re-select at 500
// trials after the 250-trial localization, correcting a pessimistic prefix.
import { describe, it, expect } from "vitest";
import { solveTarget } from "../solve-target";
import type { PoSSolveResult } from "../solve-types";

// Minimal tree: leverSearchConfig(living-expense-scale) reads expenses/incomes/
// accounts to size the search ceiling; applyMutations([]) must survive it.
const tree = {
  accounts: [],
  savingsRules: [],
  expenses: [{ type: "living", annualAmount: 200_000, startYear: 2040, endYear: 2070, growthRate: 0.025 }],
  incomes: [],
  liabilities: [],
  withdrawalStrategy: [],
  planSettings: { planStartYear: 2026 },
  giftEvents: [],
  rothConversions: [],
  client: {},
} as never;

const mcPayload = {
  indices: [], correlation: [], seed: 1, accountMixes: [], requiredMinimumAssetLevel: 0,
} as never;

describe("solveTarget living-expense refine", () => {
  it("re-selects the max spend at 500 trials, correcting a pessimistic 250-prefix", async () => {
    // True (500) PoS crosses 0.85 at $150k; the 250-prefix reads 0.02 low.
    const evaluate = async (value: number, trials: number) => {
      const truth = Math.max(0, Math.min(1, 1 - value / 1_000_000)); // 0.85 at 150k
      const pos = trials >= 500 ? truth : Math.max(0, truth - 0.02);
      return { pos, projection: [] as never };
    };
    const result = await solveTarget({
      effectiveTree: tree,
      mcPayload,
      baselineMutations: [],
      target: { kind: "living-expense-scale" },
      targetPoS: 0.85,
      evaluate,
    }) as PoSSolveResult;
    expect(result.solvedValue).toBe(150_000);
    expect(Math.abs(result.achievedPoS - 0.85)).toBeLessThanOrEqual(0.01);
    expect(result.canonicalPoS).toBe(result.achievedPoS);
  });
});
