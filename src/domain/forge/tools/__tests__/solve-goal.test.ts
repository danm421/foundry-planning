// src/domain/forge/tools/__tests__/solve-goal.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { PoSSolveResult } from "@/lib/solver/solve-types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";

const loadEffectiveTree = vi.fn();
const loadMonteCarloData = vi.fn();
const solveTarget = vi.fn();
const verifyClientAccess = vi.fn();

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({
  loadMonteCarloData: (...a: unknown[]) => loadMonteCarloData(...a),
}));
vi.mock("@/lib/solver/solve-target", () => ({
  solveTarget: (...a: unknown[]) => solveTarget(...a),
}));
vi.mock("@/engine", () => ({ runProjection: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (...a: unknown[]) => verifyClientAccess(...a),
}));

import { buildWhatIfTools } from "../whatif";

const CTX = {
  ctx: { userId: "u1", firmId: "firm-1", clientId: "client-1", scenarioId: "base" },
  conversationId: "conv-1",
};
function toolByName(name: string) {
  const t = buildWhatIfTools(CTX).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not built`);
  return t;
}

const PAYLOAD = { seed: 424242, indices: [], correlation: [], accountMixes: [], startingLiquidBalance: 0, requiredMinimumAssetLevel: 0 } as MonteCarloPayload;

beforeEach(() => {
  vi.clearAllMocks();
  verifyClientAccess.mockResolvedValue(true);
  loadEffectiveTree.mockResolvedValue({
    effectiveTree: { id: "tree" } as unknown as ClientData,
    warnings: [],
    resolutionContext: { resolver: "rc" },
  });
  loadMonteCarloData.mockResolvedValue(PAYLOAD);
});

describe("solve_goal", () => {
  it("loads the MC payload for the scenario (seed reuse) and passes resolutionContext into solveTarget", async () => {
    const result: PoSSolveResult = {
      objective: "pos",
      status: "converged",
      solvedValue: 67,
      achievedPoS: 0.86,
      canonicalPoS: 0.85,
      iterations: 7,
      finalProjection: [{ year: 2060, portfolioAssets: { liquidTotal: 2_000_000 } } as unknown as ProjectionYear],
      seed: 424242,
    };
    solveTarget.mockResolvedValue(result);
    const tool = toolByName("solve_goal");
    await tool.invoke({
      clientId: "client-1",
      scenarioId: "base",
      target: { kind: "retirement-age", person: "client" },
      targetPoS: 0.85,
    });
    expect(loadMonteCarloData).toHaveBeenCalledWith("client-1", "firm-1", "base");
    expect(solveTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveTree: { id: "tree" },
        mcPayload: PAYLOAD,
        baselineMutations: [],
        target: { kind: "retirement-age", person: "client" },
        targetPoS: 0.85,
        resolutionContext: { resolver: "rc" },
      }),
    );
  });

  it("reports the canonical 1000-trial PoS (not the 250-trial search) + seed", async () => {
    solveTarget.mockResolvedValue({
      objective: "pos",
      status: "converged",
      solvedValue: 1_500_000,
      achievedPoS: 0.91, // 250-trial search value
      canonicalPoS: 0.88, // canonical 1000-trial value
      iterations: 9,
      finalProjection: [{ year: 2060, portfolioAssets: { liquidTotal: 3_100_000 } } as unknown as ProjectionYear],
      seed: 99,
    } satisfies PoSSolveResult);
    const tool = toolByName("solve_goal");
    const out = JSON.parse(
      String(
        await tool.invoke({
          clientId: "client-1",
          scenarioId: "base",
          target: { kind: "living-expense-scale" },
          targetPoS: 0.9,
        }),
      ),
    );
    expect(out.solvedValue).toBe(1_500_000);
    expect(out.achievedPoS).toBe(0.91);
    expect(out.canonicalPoS).toBe(0.88);
    expect(out.reportedPoS).toBe(0.88); // canonical is what we headline
    expect(out.seed).toBe(99);
    expect(out.endingPortfolio).toBe(3_100_000);
    expect(out.status).toBe("converged");
  });

  it("blocks a cross-scope clientId", async () => {
    const tool = toolByName("solve_goal");
    const out = String(
      await tool.invoke({ clientId: "x", scenarioId: "base", target: { kind: "living-expense-scale" }, targetPoS: 0.85 }),
    );
    expect(out).toMatch(/scope|authorized|not found/i);
    expect(solveTarget).not.toHaveBeenCalled();
  });
});
