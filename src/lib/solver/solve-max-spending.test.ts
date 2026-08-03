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

  it("reports an honest no-lever result instead of solving when there is no retirement living-expense row", async () => {
    // No retirement living-expense row at all. Since Task 3 removed the
    // solver's old "synthesize a retirement row" fallback, `living-expense-
    // amount` is now a true no-op on a tree like this: every candidate dollar
    // amount mutates to the SAME tree, so a real evaluator would return a
    // CONSTANT PoS regardless of `dollars` (modeled here directly, rather than
    // via a dollars-sensitive fake, to mirror that real no-op behavior).
    // Bisecting over a constant function would otherwise silently report the
    // search ceiling as "solved" (if PoS ≥ target everywhere) — a fabricated,
    // confidently wrong dollar figure.
    const zeroBaseTree = {
      planSettings: { planStartYear: 2026, inflationRate: 0.025 },
      incomes: [],
      accounts: [{ id: "a", value: 5_000_000 }],
      expenses: [],
    } as unknown as ClientData;
    let calls = 0;
    const evaluateSpend = async () => {
      calls++;
      return 0.95; // constant PoS — the real no-op evaluator's shape
    };
    const r = await solveMaxSpending(args({ tree: zeroBaseTree, evaluateSpend }));
    expect(r.status).toBe("no-retirement-expense");
    expect(r.realAnnualSpend).toBe(0);
    expect(r.scaleFactor).toBe(0);
    expect(r.achievedPoS).toBe(0.95);
    // Without the guard, bisect + refineOnGrid would call evaluateSpend
    // 10+ times and return `realAnnualSpend` at the search ceiling with
    // status "converged" — a fabricated answer. The guard must short-circuit
    // before any of that runs.
    expect(calls).toBe(1);
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

  it("falls back to the full-range bisect when the straightline evaluator throws", async () => {
    // Phase-0 warm start raises instead of resolving — the exception must not
    // propagate and kill the solve; it degrades to the same full-range answer
    // as the "uninformative straightline" fallback case above.
    const r = await solveMaxSpending(
      args({
        evaluateStraightline: async () => {
          throw new Error("projection blew up");
        },
      }),
    );
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBe(30_000);
  });
});
