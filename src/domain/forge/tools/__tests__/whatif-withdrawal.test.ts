// src/domain/copilot/tools/__tests__/whatif-withdrawal.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";

const loadEffectiveTree = vi.fn();
const runProjection = vi.fn();
const applyScenarioChanges = vi.fn();
const verifyClientAccess = vi.fn();

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));
vi.mock("@/engine", () => ({ runProjection: (...a: unknown[]) => runProjection(...a) }));
vi.mock("@/engine/scenario/applyChanges", () => ({
  applyScenarioChanges: (...a: unknown[]) => applyScenarioChanges(...a),
}));
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
function projYear(over: Partial<ProjectionYear>): ProjectionYear {
  return {
    year: 2026,
    taxResult: { flow: { totalTax: 0 } },
    portfolioAssets: { liquidTotal: 0 },
    ...over,
  } as unknown as ProjectionYear;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyClientAccess.mockResolvedValue(true);
  loadEffectiveTree.mockResolvedValue({
    effectiveTree: { withdrawalStrategy: ["taxable", "tax_deferred", "tax_free"] } as unknown as ClientData,
    warnings: [],
    resolutionContext: undefined,
  });
  applyScenarioChanges.mockReturnValue({
    effectiveTree: { withdrawalStrategy: ["tax_free", "tax_deferred", "taxable"] } as unknown as ClientData,
    warnings: [],
  });
});

describe("whatif_withdrawal", () => {
  it("edits withdrawalStrategy via a withdrawal_strategy edit change ({from,to})", async () => {
    runProjection.mockReturnValue([projYear({})]);
    const tool = toolByName("whatif_withdrawal");
    await tool.invoke({
      clientId: "client-1",
      scenarioId: "base",
      withdrawalStrategy: ["tax_free", "tax_deferred", "taxable"],
    });
    expect(applyScenarioChanges).toHaveBeenCalledTimes(1);
    const changes = applyScenarioChanges.mock.calls[0][1] as ScenarioChange[];
    expect(changes).toHaveLength(1);
    expect(changes[0].opType).toBe("edit");
    expect(changes[0].targetKind).toBe("withdrawal_strategy");
    expect(changes[0].payload).toEqual({
      withdrawalStrategy: {
        from: ["taxable", "tax_deferred", "tax_free"],
        to: ["tax_free", "tax_deferred", "taxable"],
      },
    });
  });

  it("reports Base->Scenario tax + ending-portfolio deltas grounded in two projection runs", async () => {
    runProjection
      .mockReturnValueOnce([projYear({ taxResult: { flow: { totalTax: 100_000 } } as ProjectionYear["taxResult"], portfolioAssets: { liquidTotal: 500_000 } as ProjectionYear["portfolioAssets"] })])
      .mockReturnValueOnce([projYear({ taxResult: { flow: { totalTax: 92_000 } } as ProjectionYear["taxResult"], portfolioAssets: { liquidTotal: 540_000 } as ProjectionYear["portfolioAssets"] })]);
    const tool = toolByName("whatif_withdrawal");
    const out = JSON.parse(
      String(await tool.invoke({ clientId: "client-1", scenarioId: "base", withdrawalStrategy: ["tax_free", "tax_deferred", "taxable"] })),
    );
    expect(out.totals.baseTax).toBe(100_000);
    expect(out.totals.scenarioTax).toBe(92_000);
    expect(out.totals.taxDelta).toBe(-8_000);
    expect(out.totals.baseEndingPortfolio).toBe(500_000);
    expect(out.totals.scenarioEndingPortfolio).toBe(540_000);
    expect(out.totals.endingPortfolioDelta).toBe(40_000);
  });

  it("blocks a cross-scope clientId", async () => {
    const tool = toolByName("whatif_withdrawal");
    const out = String(await tool.invoke({ clientId: "x", scenarioId: "base", withdrawalStrategy: ["taxable"] }));
    expect(out).toMatch(/scope|authorized|not found/i);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });
});
