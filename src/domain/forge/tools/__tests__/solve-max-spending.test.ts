// src/domain/forge/tools/__tests__/solve-max-spending.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData } from "@/engine/types";
import type { MaxSpendResult } from "@/lib/solver/solve-max-spending";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";

const loadEffectiveTree = vi.fn();
const loadMonteCarloData = vi.fn();
const solveMaxSpending = vi.fn();
const verifyClientAccess = vi.fn();

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({
  loadMonteCarloData: (...a: unknown[]) => loadMonteCarloData(...a),
}));
vi.mock("@/lib/solver/solve-max-spending", () => ({
  solveMaxSpending: (...a: unknown[]) => solveMaxSpending(...a),
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

const PAYLOAD = { seed: 7, indices: [], correlation: [], accountMixes: [], startingLiquidBalance: 0, requiredMinimumAssetLevel: 0 } as MonteCarloPayload;

beforeEach(() => {
  vi.clearAllMocks();
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "firm-1", access: "own" });
  loadEffectiveTree.mockResolvedValue({
    effectiveTree: { id: "tree" } as unknown as ClientData,
    warnings: [],
    resolutionContext: undefined,
  });
  loadMonteCarloData.mockResolvedValue(PAYLOAD);
});

describe("solve_max_spending", () => {
  it("passes tree + mcPayload (seed reuse) + targetPoS into solveMaxSpending", async () => {
    solveMaxSpending.mockResolvedValue({
      realAnnualSpend: 180_000,
      scaleFactor: 1.2,
      achievedPoS: 0.85,
      status: "converged",
    } satisfies MaxSpendResult);
    const tool = toolByName("solve_max_spending");
    await tool.invoke({ clientId: "client-1", scenarioId: "base", targetPoS: 0.85 });
    expect(loadMonteCarloData).toHaveBeenCalledWith("client-1", "firm-1", "base");
    expect(solveMaxSpending).toHaveBeenCalledWith(
      expect.objectContaining({ tree: { id: "tree" }, mcPayload: PAYLOAD, targetPoS: 0.85 }),
    );
  });

  it("reports max real annual spend + canonical PoS + scale factor", async () => {
    solveMaxSpending.mockResolvedValue({
      realAnnualSpend: 204_000,
      scaleFactor: 1.36,
      achievedPoS: 0.842,
      status: "converged",
    } satisfies MaxSpendResult);
    const tool = toolByName("solve_max_spending");
    const out = JSON.parse(
      String(await tool.invoke({ clientId: "client-1", scenarioId: "base", targetPoS: 0.85 })),
    );
    expect(out.realAnnualSpend).toBe(204_000);
    expect(out.scaleFactor).toBe(1.36);
    expect(out.achievedPoS).toBe(0.842);
    expect(out.status).toBe("converged");
  });

  it("blocks a cross-scope clientId", async () => {
    const tool = toolByName("solve_max_spending");
    const out = String(await tool.invoke({ clientId: "x", scenarioId: "base", targetPoS: 0.85 }));
    expect(out).toMatch(/scope|authorized|not found/i);
    expect(solveMaxSpending).not.toHaveBeenCalled();
  });
});
