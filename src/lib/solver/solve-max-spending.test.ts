import { describe, it, expect } from "vitest";
import { solveMaxSpending, type SolveMaxSpendingArgs } from "./solve-max-spending";
import type { ClientData } from "@/engine/types";

// Tree whose retirement living spend (today's $) totals 100_000.
const tree = {
  planSettings: { planStartYear: 2026, inflationRate: 0.025 },
  expenses: [
    { id: "ret", type: "living", name: "Retirement Living", annualAmount: 100_000,
      startYear: 2040, endYear: 2070, growthRate: 0.025 },
  ],
} as unknown as ClientData;

// PoS decreases linearly with scale: PoS(0)=1.0, PoS(2.0)=0.0. Crosses 0.85 at scale 0.30.
const linearPoS = async (scale: number) => Math.max(0, Math.min(1, 1 - scale / 2));

function args(over: Partial<SolveMaxSpendingArgs> = {}): SolveMaxSpendingArgs {
  return {
    tree,
    // mcPayload is unused when evaluateScale is injected.
    mcPayload: {} as never,
    targetPoS: 0.85,
    evaluateScale: linearPoS,
    ...over,
  };
}

describe("solveMaxSpending", () => {
  it("solves the scale closest to target, in $5k-rounded today's dollars", async () => {
    const r = await solveMaxSpending(args());
    // scale 0.30 → 0.30 * 100_000 = 30_000 (already a multiple of 5k).
    expect(r.status).toBe("converged");
    expect(r.realAnnualSpend).toBe(30_000);
    expect(r.achievedPoS).toBeGreaterThanOrEqual(0.85 - 0.02);
  });

  it("returns $0 / unreachable when even zero spend misses the target", async () => {
    const r = await solveMaxSpending(args({ evaluateScale: async () => 0.5 }));
    expect(r.status).toBe("unreachable");
    expect(r.realAnnualSpend).toBe(0);
  });

  it("clamps to the bracket cap when the plan always beats the target", async () => {
    const r = await solveMaxSpending(args({ evaluateScale: async () => 0.99 }));
    expect(r.realAnnualSpend).toBe(roundCap()); // 3.0 * 100_000 = 300_000
    function roundCap() { return 300_000; }
  });
});
