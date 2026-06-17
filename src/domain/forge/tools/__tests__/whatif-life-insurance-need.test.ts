// src/domain/forge/tools/__tests__/whatif-life-insurance-need.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";

const loadEffectiveTree = vi.fn();
const runLifeInsuranceWhatIf = vi.fn();
const survivorEndingPortfolio = vi.fn();
const verifyClientAccess = vi.fn();

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));
vi.mock("@/engine/what-if/life-insurance-need", () => ({
  runLifeInsuranceWhatIf: (...a: unknown[]) => runLifeInsuranceWhatIf(...a),
  survivorEndingPortfolio: (...a: unknown[]) => survivorEndingPortfolio(...a),
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
    resolutionContext: undefined,
  });
  // Each whatif returns a stub projection; survivorEndingPortfolio maps face -> ending.
  runLifeInsuranceWhatIf.mockReturnValue([] as ProjectionYear[]);
});

describe("whatif_life_insurance_need", () => {
  it("bisects to the smallest face value whose survivor ending portfolio clears the target", async () => {
    // Linear model: survivor ending portfolio = faceValue - 500_000.
    // Target 0 -> need face >= 500_000. With a $5M ceiling and $10k tolerance the
    // bisection should land within one step of 500_000.
    survivorEndingPortfolio.mockImplementation((_proj, _dec, _data) => {
      const face = runLifeInsuranceWhatIf.mock.calls.at(-1)![0].faceValue as number;
      return face - 500_000;
    });
    const tool = toolByName("whatif_life_insurance_need");
    const out = JSON.parse(
      String(
        await tool.invoke({
          clientId: "client-1",
          scenarioId: "base",
          deceased: "client",
          deathYear: 2030,
        }),
      ),
    );
    expect(out.solvedFaceValue).toBeGreaterThanOrEqual(500_000);
    expect(out.solvedFaceValue).toBeLessThanOrEqual(520_000); // within one $10k tolerance step
    expect(out.targetSurvivorPortfolio).toBe(0);
    // Resolved tree, not hand-built.
    expect(loadEffectiveTree).toHaveBeenCalledWith("client-1", "firm-1", "base", {});
  });

  it("is deterministic: same inputs -> same solved face value (no Monte Carlo)", async () => {
    survivorEndingPortfolio.mockImplementation(() => {
      const face = runLifeInsuranceWhatIf.mock.calls.at(-1)![0].faceValue as number;
      return face - 750_000;
    });
    const tool = toolByName("whatif_life_insurance_need");
    const args = { clientId: "client-1", scenarioId: "base", deceased: "spouse" as const, deathYear: 2032 };
    const a = JSON.parse(String(await tool.invoke(args)));
    vi.clearAllMocks();
    verifyClientAccess.mockResolvedValue(true);
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { id: "tree" } as unknown as ClientData, warnings: [], resolutionContext: undefined });
    runLifeInsuranceWhatIf.mockReturnValue([]);
    survivorEndingPortfolio.mockImplementation(() => {
      const face = runLifeInsuranceWhatIf.mock.calls.at(-1)![0].faceValue as number;
      return face - 750_000;
    });
    const b = JSON.parse(String(await tool.invoke(args)));
    expect(a.solvedFaceValue).toBe(b.solvedFaceValue);
  });

  it("regression: solved face always clears target when bisection hi falls between $10k grid lines", async () => {
    // With REQUIREMENT=211_000, the bisection [0, 5M] converges to hi=214843.75.
    // Math.round(214843.75/10000)*10000 = 210000 (rounds DOWN — below requirement).
    // Math.ceil(214843.75/10000)*10000  = 220000 (rounds UP  — clears requirement).
    // This test confirms the tool reports solvedSurvivorPortfolio >= target (0) and
    // solvedFaceValue >= REQUIREMENT. It FAILS with Math.round and PASSES with Math.ceil.
    const REQUIREMENT = 211_000;
    survivorEndingPortfolio.mockImplementation(() => {
      const face = runLifeInsuranceWhatIf.mock.calls.at(-1)![0].faceValue as number;
      return face - REQUIREMENT;
    });
    const tool = toolByName("whatif_life_insurance_need");
    const out = JSON.parse(
      String(
        await tool.invoke({
          clientId: "client-1",
          scenarioId: "base",
          deceased: "client",
          deathYear: 2030,
          targetSurvivorPortfolio: 0,
        }),
      ),
    );
    // The contract: the reported portfolio must be at or above the target.
    expect(out.solvedSurvivorPortfolio).toBeGreaterThanOrEqual(out.targetSurvivorPortfolio);
    // And the face value itself must cover the requirement.
    expect(out.solvedFaceValue).toBeGreaterThanOrEqual(REQUIREMENT);
  });

  it("blocks a cross-scope clientId", async () => {
    const tool = toolByName("whatif_life_insurance_need");
    const out = String(await tool.invoke({ clientId: "x", scenarioId: "base", deceased: "client", deathYear: 2030 }));
    expect(out).toMatch(/scope|authorized|not found/i);
    expect(runLifeInsuranceWhatIf).not.toHaveBeenCalled();
  });
});
