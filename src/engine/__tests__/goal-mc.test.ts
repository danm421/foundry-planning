import { describe, it, expect } from "vitest";
import { runGoalMc } from "../goals/goal-mc";

describe("runGoalMc", () => {
  it("100% success when the pool dwarfs the goal with zero volatility", () => {
    const r = runGoalMc({
      startingBalance: 1_000_000, contributionsByYear: [0, 0], withdrawalsByYear: [10_000, 10_000],
      arithMean: 0.05, stdDev: 0, seed: 42, trials: 200,
    });
    expect(r.successRate).toBe(1);
  });

  it("0% success when the pool can never cover the goal (zero vol, underfunded)", () => {
    const r = runGoalMc({
      startingBalance: 5_000, contributionsByYear: [0], withdrawalsByYear: [40_000],
      arithMean: 0.05, stdDev: 0, seed: 42, trials: 200,
    });
    expect(r.successRate).toBe(0);
  });

  it("coveredByCashFlow → 100% success even when the pool can never cover the cost", () => {
    // Same underfunded pool as above, but the goal pays the gap from cash flow.
    const r = runGoalMc({
      startingBalance: 5_000, contributionsByYear: [0], withdrawalsByYear: [40_000],
      coveredByCashFlow: true, arithMean: 0.05, stdDev: 0.18, seed: 42, trials: 200,
    });
    expect(r.successRate).toBe(1);
  });

  it("is deterministic given a fixed seed", () => {
    const args = { startingBalance: 50_000, contributionsByYear: [3000, 3000, 3000], withdrawalsByYear: [0, 20_000, 20_000], arithMean: 0.06, stdDev: 0.12, seed: 7, trials: 500 } as const;
    expect(runGoalMc({ ...args }).successRate).toBe(runGoalMc({ ...args }).successRate);
  });

  it("volatility produces an intermediate success rate", () => {
    const r = runGoalMc({
      startingBalance: 40_000, contributionsByYear: [0, 0], withdrawalsByYear: [0, 40_000],
      arithMean: 0.06, stdDev: 0.18, seed: 123, trials: 1000,
    });
    expect(r.successRate).toBeGreaterThan(0);
    expect(r.successRate).toBeLessThan(1);
  });
});
