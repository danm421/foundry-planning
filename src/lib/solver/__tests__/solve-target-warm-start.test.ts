// src/lib/solver/__tests__/solve-target-warm-start.test.ts
//
// solveTarget warm-start wiring: deterministic seed + secant bracket ahead of
// the (narrowed) bisect, per-lever, with phase-tagged progress events.
import { describe, it, expect } from "vitest";
import { solveTarget } from "../solve-target";
import type { PoSSolveResult, SolveProgressEvent } from "../solve-types";

// Fixture mirrors solve-target-refine.test.ts: minimal tree that survives
// leverSearchConfig + applyMutations([]). Ceiling = max(3×200k, 300k) = 600k.
const tree = {
  accounts: [],
  savingsRules: [{ accountId: "acct-1", annualAmount: 10_000 }],
  expenses: [{ type: "living", annualAmount: 200_000, startYear: 2040, endYear: 2070, growthRate: 0.025 }],
  incomes: [],
  liabilities: [],
  withdrawalStrategy: [],
  planSettings: { planStartYear: 2026 },
  giftEvents: [],
  rothConversions: [{ id: "rc-1", fixedAmount: 50_000 }],
  client: {},
} as never;

const mcPayload = {
  indices: [], correlation: [], seed: 1, accountMixes: [], requiredMinimumAssetLevel: 0,
} as never;

describe("solveTarget warm start", () => {
  it("living-expense: warm start cuts search evals and refine still lands the 500-trial answer", async () => {
    const events: SolveProgressEvent[] = [];
    // True (500) PoS crosses 0.85 at $150k; the 250-prefix reads 0.019 low
    // (0.019 not 0.02: an offset of exactly 0.02 lands a warm probe at PoS
    // bit-identical to the target, degenerating bisect's regula falsi — a
    // coincidental edge case, not the typical path this test exercises).
    const evaluate = async (value: number, trials: number) => {
      const truth = Math.max(0, Math.min(1, 1 - value / 1_000_000));
      const pos = trials >= 500 ? truth : Math.max(0, truth - 0.019);
      return { pos, projection: [] as never };
    };
    const result = (await solveTarget({
      effectiveTree: tree,
      mcPayload,
      baselineMutations: [],
      target: { kind: "living-expense-scale" },
      targetPoS: 0.85,
      evaluate,
      // Straightline boundary sits near the true crossing, as in production
      // (the deterministic projection tracks the same tree the MC trials sample).
      evaluateStraightline: async (dollars) => dollars <= 155_000,
      onProgress: (e) => events.push(e),
    })) as PoSSolveResult;

    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(150_000);
    const searchEvents = events.filter((e) => e.phase === "search");
    const refineEvents = events.filter((e) => e.phase === "refine");
    expect(searchEvents.length).toBeLessThanOrEqual(6); // old path used ~10
    expect(refineEvents.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.phase === "search" || e.phase === "refine")).toBe(true);
  });

  it("savings-contribution (+1 direction): warm start brackets and solves", async () => {
    // PoS rises with contribution: 0.5 at $0 → 1.0 at $40k; crosses 0.85 at $28k.
    // Config for annualAmount 10k: hi = min(100k, 4×10k) = 40k, step 1k.
    let searchEvals = 0;
    const evaluate = async (value: number) => {
      searchEvals += 1;
      return { pos: Math.min(1, 0.5 + (value / 40_000) * 0.5), projection: [] as never };
    };
    const result = (await solveTarget({
      effectiveTree: tree,
      mcPayload,
      baselineMutations: [],
      target: { kind: "savings-contribution", accountId: "acct-1" },
      targetPoS: 0.85,
      evaluate,
      evaluateStraightline: async (value) => value >= 20_000,
    })) as PoSSolveResult;
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(28_000);
    expect(searchEvals).toBeLessThanOrEqual(5);
  });

  it("roth (uninformative straightline): falls back to the full-range bisect", async () => {
    // Config for fixedAmount 50k: hi = min(1M, 4×50k) = 200k, step 1k.
    const straightlineCalls: number[] = [];
    // PoS rises 0.7 → 1.0 across [0, 200k]; crosses 0.85 at exactly $100k.
    const evaluate = async (value: number) => ({
      pos: Math.min(1, 0.7 + (value / 200_000) * 0.3),
      projection: [] as never,
    });
    const result = (await solveTarget({
      effectiveTree: tree,
      mcPayload,
      baselineMutations: [],
      target: { kind: "roth-conversion-amount", techniqueId: "rc-1" },
      targetPoS: 0.85,
      evaluate,
      evaluateStraightline: async (v) => {
        straightlineCalls.push(v);
        return true; // conversions don't move straightline success
      },
    })) as PoSSolveResult;
    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(100_000);
    // Warm start probed exactly the two endpoints, found them agreeing, bailed.
    expect(straightlineCalls).toEqual([0, 200_000]);
  });

  it("living-expense (straightline throws): falls back to the full-range bisect", async () => {
    // Phase-0 warm start raises instead of resolving — the exception must not
    // propagate and kill the solve; the full-range bisect lands the same
    // answer as the warm-started first test above.
    const evaluate = async (value: number, trials: number) => {
      const truth = Math.max(0, Math.min(1, 1 - value / 1_000_000));
      const pos = trials >= 500 ? truth : Math.max(0, truth - 0.019);
      return { pos, projection: [] as never };
    };
    const result = (await solveTarget({
      effectiveTree: tree,
      mcPayload,
      baselineMutations: [],
      target: { kind: "living-expense-scale" },
      targetPoS: 0.85,
      evaluate,
      evaluateStraightline: async () => {
        throw new Error("projection blew up");
      },
    })) as PoSSolveResult;

    expect(result.status).toBe("converged");
    expect(result.solvedValue).toBe(150_000);
  });
});
