import { describe, it, expect } from "vitest";
import { solveMaxSpending, type SolveMaxSpendingArgs } from "./solve-max-spending";
import type { ClientData } from "@/engine/types";

// Tree whose retirement living spend (today's $) totals 100_000, with no other
// income/assets so the resource-aware ceiling collapses to 3× the stated spend.
const tree = {
  planSettings: { planStartYear: 2026, inflationRate: 0.025 },
  incomes: [],
  accounts: [],
  expenses: [
    { id: "ret", type: "living", name: "Retirement Living", annualAmount: 100_000,
      startYear: 2040, endYear: 2070, growthRate: 0.025 },
  ],
} as unknown as ClientData;

// PoS decreases linearly with spend: PoS(0)=1.0, PoS(200_000)=0.0. Crosses 0.85
// at $30,000. The solver now searches in dollar space, so the evaluator takes
// dollars (not a scale factor).
const linearPoS = async (dollars: number) => Math.max(0, Math.min(1, 1 - dollars / 200_000));

function args(over: Partial<SolveMaxSpendingArgs> = {}): SolveMaxSpendingArgs {
  return {
    tree,
    // mcPayload is unused when evaluateSpend is injected.
    mcPayload: {} as never,
    targetPoS: 0.85,
    evaluateSpend: linearPoS,
    ...over,
  };
}

describe("solveMaxSpending", () => {
  it("solves the spend closest to target, in $5k-rounded today's dollars", async () => {
    const r = await solveMaxSpending(args());
    // PoS crosses 0.85 at $30,000 (already a multiple of $5k).
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBe(30_000);
    expect(r.achievedPoS).toBeGreaterThanOrEqual(0.85 - 0.02);
  });

  it("returns $0 / unreachable when even zero spend misses the target", async () => {
    const r = await solveMaxSpending(args({ evaluateSpend: async () => 0.5 }));
    expect(r.status).toBe("unreachable");
    expect(r.realAnnualSpend).toBe(0);
  });

  it("widens the ceiling to the resource-aware bound, not 3× the stated expense", async () => {
    // Modest $60k stated retirement spend but an $8M portfolio. The resource-aware
    // ceiling is max(3×60k=180k, income+10%·assets=800k) = $800k, so the search can
    // reach a sustainable spend well above the old 3× ($180k) cap.
    const richTree = {
      planSettings: { planStartYear: 2026, inflationRate: 0.025 },
      incomes: [],
      accounts: [{ id: "a", value: 8_000_000 }],
      expenses: [
        { id: "ret", type: "living", name: "Retirement Living", annualAmount: 60_000,
          startYear: 2040, endYear: 2070, growthRate: 0.025 },
      ],
    } as unknown as ClientData;
    // Linear PoS crossing 0.85 at exactly $500,000 (1 − 500k/3,333,333 = 0.85).
    const evaluateSpend = async (dollars: number) =>
      Math.max(0, Math.min(1, 1 - dollars / 3_333_333));
    const r = await solveMaxSpending(args({ tree: richTree, evaluateSpend }));
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBeGreaterThan(180_000); // old resource-blind cap
    expect(Math.abs(r.realAnnualSpend - 500_000)).toBeLessThanOrEqual(10_000);
  });

  it("synthesizes a spend when the plan states $0 retirement living expense", async () => {
    // No retirement living-expense row at all (baseSpend === 0), but a $5M portfolio.
    // The old scale-space solver returned $0 unconditionally; the dollar-space search
    // finds the real sustainable spend.
    const zeroBaseTree = {
      planSettings: { planStartYear: 2026, inflationRate: 0.025 },
      incomes: [],
      accounts: [{ id: "a", value: 5_000_000 }],
      expenses: [],
    } as unknown as ClientData;
    // Linear PoS crossing 0.85 at exactly $100,000 (1 − 100k/666,666 = 0.85).
    const evaluateSpend = async (dollars: number) =>
      Math.max(0, Math.min(1, 1 - dollars / 666_666));
    const r = await solveMaxSpending(args({ tree: zeroBaseTree, evaluateSpend }));
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBeGreaterThan(0);
    expect(Math.abs(r.realAnnualSpend - 100_000)).toBeLessThanOrEqual(10_000);
    expect(r.scaleFactor).toBe(0); // no stated base to scale from
  });

  it("re-selects at higher trials, correcting a pessimistic 250-trial prefix", async () => {
    // 500-trial PoS is the truth (0.85 at $30k); the 250-trial prefix reads 0.03 low,
    // so phase 1 alone would undershoot.
    const evaluateSpend = async (dollars: number, trials: number) => {
      const truth = Math.max(0, Math.min(1, 1 - dollars / 200_000));
      return trials >= 500 ? truth : Math.max(0, truth - 0.03);
    };
    const r = await solveMaxSpending(args({ evaluateSpend }));
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBe(30_000); // corrected up from the ~25k a 250-only solve gives
    expect(Math.abs(r.achievedPoS - 0.85)).toBeLessThanOrEqual(0.01);
  });
});

describe("solveMaxSpending warm start", () => {
  // Deterministic straightline succeeds up to $100k spend (≈ PoS 0.5 on the
  // linear curve) — an informative seed.
  const straightline = async (dollars: number) => dollars <= 100_000;

  it("solves the same answer with far fewer MC evaluations", async () => {
    const searchCalls: number[] = [];
    const refineCalls: number[] = [];
    const counting = async (dollars: number, trials: number) => {
      (trials >= 500 ? refineCalls : searchCalls).push(dollars);
      return linearPoS(dollars);
    };
    const r = await solveMaxSpending(
      args({ evaluateSpend: counting, evaluateStraightline: straightline }),
    );
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBe(30_000);
    // Warm path: ~3 secant probes + collapsed bisect. Old path used ~9-11.
    expect(searchCalls.length).toBeLessThanOrEqual(5);
    expect(refineCalls.length).toBeLessThanOrEqual(3);
  });

  it("reports unreachable from a warm-start endpoint resolution", async () => {
    const r = await solveMaxSpending(
      args({ evaluateSpend: async () => 0.5, evaluateStraightline: straightline }),
    );
    expect(r.status).toBe("unreachable");
    expect(r.realAnnualSpend).toBe(0);
    expect(r.achievedPoS).toBe(0.5);
  });

  it("falls back to the full-range bisect when the straightline is uninformative", async () => {
    // Straightline succeeds everywhere (both endpoints agree) → no seed.
    const r = await solveMaxSpending(
      args({ evaluateStraightline: async () => true }),
    );
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBe(30_000);
  });
});
