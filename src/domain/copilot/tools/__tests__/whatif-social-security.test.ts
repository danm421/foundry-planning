// src/domain/copilot/tools/__tests__/whatif-social-security.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData } from "@/engine/types";
import type { EndingPortfolioSolveResult } from "@/lib/solver/solve-types";

const loadEffectiveTree = vi.fn();
const solveSsClaimAgeByPortfolio = vi.fn();
const verifyClientAccess = vi.fn();

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));
vi.mock("@/lib/solver/solve-ss-portfolio", () => ({
  solveSsClaimAgeByPortfolio: (...a: unknown[]) => solveSsClaimAgeByPortfolio(...a),
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

beforeEach(() => {
  vi.clearAllMocks();
  verifyClientAccess.mockResolvedValue(true);
  loadEffectiveTree.mockResolvedValue({
    effectiveTree: { id: "tree" } as unknown as ClientData,
    warnings: [],
    resolutionContext: { resolver: "rc" },
  });
});

describe("whatif_social_security", () => {
  it("passes the loadEffectiveTree result + resolutionContext + person into the solver", async () => {
    const result: EndingPortfolioSolveResult = {
      objective: "ending-portfolio",
      status: "converged",
      solvedValue: 70,
      endingPortfolio: 1_200_000,
      candidates: [
        { value: 62, endingPortfolio: 900_000 },
        { value: 70, endingPortfolio: 1_200_000 },
      ],
      finalProjection: [],
    };
    solveSsClaimAgeByPortfolio.mockReturnValue(result);
    const tool = toolByName("whatif_social_security");
    await tool.invoke({ clientId: "client-1", scenarioId: "base", person: "client" });
    expect(loadEffectiveTree).toHaveBeenCalledWith("client-1", "firm-1", "base", {});
    expect(solveSsClaimAgeByPortfolio).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveTree: { id: "tree" },
        person: "client",
        baselineMutations: [],
        resolutionContext: { resolver: "rc" },
      }),
    );
  });

  it("returns the best claim age + candidates table (grounded in the solver result)", async () => {
    solveSsClaimAgeByPortfolio.mockReturnValue({
      objective: "ending-portfolio",
      status: "converged",
      solvedValue: 67,
      endingPortfolio: 1_050_000,
      candidates: [
        { value: 62, endingPortfolio: 900_000 },
        { value: 67, endingPortfolio: 1_050_000 },
        { value: 70, endingPortfolio: 1_010_000 },
      ],
      finalProjection: [],
    });
    const tool = toolByName("whatif_social_security");
    const out = JSON.parse(
      String(await tool.invoke({ clientId: "client-1", scenarioId: "base", person: "client" })),
    );
    expect(out.bestClaimAge).toBe(67);
    expect(out.bestEndingPortfolio).toBe(1_050_000);
    expect(out.candidates).toHaveLength(3);
    expect(out.candidates[1]).toEqual({ claimAge: 67, endingPortfolio: 1_050_000 });
  });

  it("blocks a cross-scope clientId", async () => {
    const tool = toolByName("whatif_social_security");
    const out = String(await tool.invoke({ clientId: "evil", scenarioId: "base", person: "client" }));
    expect(out).toMatch(/scope|authorized|not found/i);
    expect(solveSsClaimAgeByPortfolio).not.toHaveBeenCalled();
  });
});
